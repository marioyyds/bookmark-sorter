importScripts('shared.js');

async function callDeepSeek(settings, messages) {
  const url = settings.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const j = await resp.json();
      detail = j.error && j.error.message ? j.error.message : JSON.stringify(j);
    } catch (e) {
      detail = await resp.text();
    }
    throw new Error('DeepSeek 请求失败 (' + resp.status + '): ' + detail);
  }

  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message.content;
  if (!content) throw new Error('DeepSeek 返回为空');
  return content.trim();
}

async function handleAi(request) {
  const settings = await getAISettings();
  if (!settings.apiKey) {
    return {
      ok: false,
      error: '尚未配置 API Key，请点击插件图标 → 设置页填写。',
      needSetup: true,
    };
  }

  const book = await getBook();
  const messages = buildAiMessages(request.action, request, settings, book);
  if (!messages) {
    return { ok: false, error: '未知操作：' + request.action };
  }

  const answer = await callDeepSeek(settings, messages);
  return { ok: true, answer };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ai') {
    handleAi(msg.payload || msg)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg && msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-stream') return;

  const controller = new AbortController();
  let aborted = false;
  port.onDisconnect.addListener(() => {
    aborted = true;
    try {
      controller.abort();
    } catch (e) {}
  });

  port.onMessage.addListener(async (payload) => {
    try {
      const settings = await getAISettings();
      if (!settings.apiKey) {
        port.postMessage({ type: 'error', needSetup: true, error: '尚未配置 API Key，请点击插件图标 → 设置页填写。' });
        return;
      }
      const book = await getBook();
      const messages = buildAiMessages(payload.action, payload, settings, book);
      if (!messages) {
        port.postMessage({ type: 'error', error: '未知操作：' + payload.action });
        return;
      }

      const url = settings.baseUrl.replace(/\/+$/, '') + '/chat/completions';
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + settings.apiKey,
        },
        body: JSON.stringify({
          model: settings.model,
          messages,
          temperature: 0.3,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        let detail = '';
        try {
          const j = await resp.json();
          detail = j.error && j.error.message ? j.error.message : JSON.stringify(j);
        } catch (e) {
          detail = await resp.text();
        }
        port.postMessage({ type: 'error', error: 'DeepSeek 请求失败 (' + resp.status + '): ' + detail });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices && json.choices[0] && json.choices[0].delta;
            if (delta && delta.content) {
              port.postMessage({ type: 'chunk', text: delta.content });
            }
          } catch (e) {
            // 忽略无法解析的行
          }
        }
      }
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:')) {
          const data = trimmed.slice(5).trim();
          if (data !== '[DONE]') {
            try {
              const json = JSON.parse(data);
              const delta = json.choices && json.choices[0] && json.choices[0].delta;
              if (delta && delta.content) {
                port.postMessage({ type: 'chunk', text: delta.content });
              }
            } catch (e) {}
          }
        }
      }
      if (!aborted) port.postMessage({ type: 'end' });
    } catch (e) {
      if (aborted) return;
      port.postMessage({ type: 'error', error: e.message });
    }
  });
});
