// Service Worker 入口（ES Module）：AI 请求 / Agent 编排 / 页面命令转发的消息监听
import { getBook } from './lib/shared/store.js';
import { getAISettings } from './lib/shared/settings.js';
import { buildAiMessages } from './lib/shared/rag.js';
import { callDeepSeek } from './lib/assistant/llm.js';
import { runAgentStream } from './lib/assistant/agent.js';
import { logError } from './lib/shared/utils.js';

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
  if (msg && msg.type === 'openManager') {
    const focusId = msg.focusId || '';
    chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') + (focusId ? '#focus=' + encodeURIComponent(focusId) : '') });
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'pageCommand') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        sendResponse({ ok: false, error: '无活动标签页' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'kbPageCommand', command: msg.command, params: msg.params || {} }, (res) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse(res || { ok: false, error: '页面命令无响应' });
        }
      });
    });
    return true;
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
      // 工具审批消息由 waitForToolApproval 的临时监听器处理，不能作为新的对话请求。
      if (payload && payload.type === 'tool-approval') return;
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
