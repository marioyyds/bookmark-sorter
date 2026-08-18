importScripts('shared.js', 'tools.js', 'mcp.js');

async function callDeepSeekOnce(settings, messages) {
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
    const err = new Error('DeepSeek 请求失败 (' + resp.status + '): ' + detail);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message.content;
  if (!content) throw new Error('DeepSeek 返回为空');
  return content.trim();
}

/** 判断错误是否可重试：网络错误（无 status）或服务端 5xx / 429 限流 */
function isRetryableError(e) {
  if (!e || !e.status) return true;
  return e.status === 429 || e.status >= 500;
}

/** 带指数退避重试的 DeepSeek 调用（最多 3 次尝试，间隔 0.5s/1s） */
async function callDeepSeek(settings, messages) {
  const MAX_RETRIES = 2;
  for (let attempt = 0; ; attempt++) {
    try {
      return await callDeepSeekOnce(settings, messages);
    } catch (e) {
      if (attempt >= MAX_RETRIES || !isRetryableError(e)) throw e;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
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

const AGENT_MAX_ITER = 6;

/**
 * 以流式方式调用一次 Agent 步骤，解析 SSE 中的 content 与 tool_calls。
 * content 实时作为 chunk 事件转发给前端；tool_calls 累积后返回。
 * @returns {Promise<{assistantMessage, toolCalls, error?}>}
 */
async function streamAgentStep(port, settings, messages, signal, tools) {
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
      tools,
      tool_choice: 'auto',
      temperature: 0.3,
      stream: true,
    }),
    signal,
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const j = await resp.json();
      detail = j.error && j.error.message ? j.error.message : JSON.stringify(j);
    } catch (e) {
      detail = await resp.text();
    }
    return { error: 'DeepSeek 请求失败 (' + resp.status + '): ' + detail };
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let contentAcc = '';
  const toolAcc = [];

  const ensureTool = (i) => {
    while (toolAcc.length <= i) toolAcc.push({ index: toolAcc.length, id: '', name: '', args: '' });
    return toolAcc[i];
  };

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
      let json;
      try {
        json = JSON.parse(data);
      } catch (e) {
        continue;
      }
      const choice = json.choices && json.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) {
        contentAcc += delta.content;
        port.postMessage({ type: 'chunk', text: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const t = ensureTool(tc.index || 0);
          if (tc.id) t.id = tc.id;
          if (tc.function) {
            if (tc.function.name) t.name = tc.function.name;
            if (tc.function.arguments) t.args += tc.function.arguments;
          }
        }
      }
    }
  }

  const toolCalls = toolAcc
    .filter((t) => t.name || t.id)
    .map((t) => ({ id: t.id, name: t.name, args: parseToolArgs(t.args) }));

  const assistantMessage = { role: 'assistant', content: contentAcc };
  if (toolCalls.length) {
    assistantMessage.tool_calls = toolCalls.map((t) => ({
      id: t.id,
      type: 'function',
      function: { name: t.name, arguments: JSON.stringify(t.args) },
    }));
  }
  return { assistantMessage, toolCalls };
}

/**
 * Agent 主循环：流式对话 + 工具调用。
 * 模型返回 tool_calls 时执行真实工具（检索/增删知识库）并把结果喂回，
 * 直到模型给出最终文本回复（流式推送）或达到最大步数。
 */
async function runAgentStream(port, payload, settings, book, signal, tabId) {
  const ctx = { book, settings, page: payload.page || '', tabId };
  const tools = await collectAgentTools(settings);
  const instruction = payload.question || payload.command || payload.text || '';
  const selectedText = payload.text || '';
  const history = Array.isArray(payload.history) ? payload.history.slice(-10) : [];

  const messages = [{ role: 'system', content: AGENT_SYSTEM_PROMPT }];
  for (const h of history) {
    if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') {
      messages.push({ role: h.role, content: h.content.slice(0, 3000) });
    }
  }
  const userParts = [];
  if (selectedText) userParts.push('选中的文本：\n' + selectedText);
  if (ctx.page) userParts.push('当前页面内容（作为背景上下文）：\n' + ctx.page);
  if (instruction) userParts.push('用户指令 / 问题：\n' + instruction);
  if (!userParts.length) userParts.push('（无输入）');
  messages.push({ role: 'user', content: userParts.join('\n\n') });

  for (let iter = 0; iter < AGENT_MAX_ITER; iter++) {
    const step = await streamAgentStep(port, settings, messages, signal, tools);
    if (step.error) {
      port.postMessage({ type: 'error', error: step.error });
      return;
    }
    messages.push(step.assistantMessage);

    if (step.toolCalls.length) {
      for (const tc of step.toolCalls) {
        const res = await executeAnyTool(tc.name, tc.args, ctx);
        if (res.citations) {
          port.postMessage({ type: 'citations', citations: res.citations });
        }
        port.postMessage({ type: 'tool', name: tc.name, args: tc.args, result: res.result });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: res.result });
      }
      continue;
    }

    port.postMessage({ type: 'end' });
    return;
  }

  port.postMessage({ type: 'chunk', text: '\n\n（已达到最大推理步数，已停止）' });
  port.postMessage({ type: 'end' });
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
  if (msg && msg.type === 'openManager') {
    const focusId = msg.focusId || '';
    chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') + (focusId ? '#focus=' + encodeURIComponent(focusId) : '') });
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
    } catch (e) {
      logError('Abort controller failed', e);
    }
  });

  port.onMessage.addListener(async (payload) => {
    try {
      const settings = await getAISettings();
      if (!settings.apiKey) {
        port.postMessage({ type: 'error', needSetup: true, error: '尚未配置 API Key，请点击插件图标 → 设置页填写。' });
        return;
      }
      const book = await getBook();
      if (payload.action === 'agent') {
        const tabId = port.sender && port.sender.tab && port.sender.tab.id;
        await runAgentStream(port, payload, settings, book, controller.signal, tabId);
        return;
      }
      const messages = buildAiMessages(payload.action, payload, settings, book);
      if (!messages) {
        port.postMessage({ type: 'error', error: '未知操作：' + payload.action });
        return;
      }

      // 发送引用来源元数据给前端（在流式响应开始前）
      if (messages._citations && messages._citations.length) {
        port.postMessage({ type: 'citations', citations: messages._citations });
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
            logError('Failed to parse SSE chunk', { data, error: e.message });
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
            } catch (e) {
              logError('Failed to parse final SSE chunk', { data, error: e.message });
            }
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
