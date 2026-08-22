// Agent 编排：流式对话 + 工具审批 + 工具调用循环
import { getToolMetadata, AGENT_SYSTEM_PROMPT, parseToolArgs, splitIntoChunks } from './tools.js';
import { collectAgentTools, executeAnyTool } from './mcp.js';
import { createRun, transition, RUN_STATUS, TOOL_STATUS } from './agent-state.js';

export const AGENT_BUDGET_DEFAULTS = Object.freeze({
  maxModelTurns: 10,
  maxToolCalls: 16,
  maxSameToolCalls: 3,
  maxDurationMs: 90000,
  toolTimeoutMs: 15000,
});

function getBudget(payload = {}, settings = {}) {
  const source = payload.agentBudget || settings.agentBudget || {};
  return Object.fromEntries(Object.entries(AGENT_BUDGET_DEFAULTS).map(([key, value]) => {
    const n = Number(source[key]);
    return [key, Number.isFinite(n) && n > 0 ? Math.floor(n) : value];
  }));
}

function withTimeout(task, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); fn(value); } };
    const onAbort = () => finish(reject, new DOMException('任务已取消', 'AbortError'));
    const timer = setTimeout(() => finish(reject, new Error('工具执行超时（' + timeoutMs + 'ms）')), timeoutMs);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(task).then((v) => finish(resolve, v), (e) => finish(reject, e));
  });
}

// 只放行纯读取类工具。其余工具可能写入本地数据、改变浏览器状态、访问外部服务，
// 按 Cline 的交互模式交由前端取得用户明确批准后再执行。
export function toolNeedsApproval(name) {
  return getToolMetadata(name).requiresApproval === true;
}

function waitForToolApproval(port, callId, name, args, signal, runId) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (approved) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      port.onMessage.removeListener(onMessage);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(approved);
    };
    const onMessage = (message) => {
      if (message && message.type === 'tool-approval' && message.callId === callId) {
        finish(message.decision || (message.approved === true ? 'once' : 'reject'));
      }
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), 60000);
    port.onMessage.addListener(onMessage);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    port.postMessage({ type: 'tool-call', runId, callId, name, args, requiresApproval: true, risk: getToolMetadata(name).risk });
  });
}

/**
 * 以流式方式调用一次 Agent 步骤，解析 SSE 中的 content 与 tool_calls。
 * content 实时作为 chunk 事件转发给前端；tool_calls 累积后返回。
 * @returns {Promise<{assistantMessage, toolCalls, error?}>}
 */
async function streamAgentStep(port, settings, messages, signal, tools, emit) {
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
        (emit || ((event) => port.postMessage(event)))({ type: 'chunk', text: delta.content });
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
export async function runAgentStream(port, payload, settings, book, signal, tabId) {
  const runId = payload.runId || 'run-' + Date.now().toString(36);
  const sessionApprovedTools = new Set();
  let eventSeq = 0;
  const emit = (event) => port.postMessage(Object.assign({ runId, seq: ++eventSeq, timestamp: Date.now() }, event));
  const budget = getBudget(payload, settings);
  const startedAt = Date.now();
  let toolCallCount = 0;
  const toolFingerprints = new Map();
  const run = createRun(runId, budget);
  const emitState = (next, meta = {}) => {
    const state = transition(run, next, meta);
    emit({ type: 'agent-state', ...state, step: run.currentStep, maxSteps: budget.maxModelTurns });
  };
  emitState(RUN_STATUS.CREATED, { budget });
  const ctx = { book, settings, page: payload.page || '', pageUrl: payload.pageUrl || '', pageTitle: payload.pageTitle || '', tabId };
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

  // 将页面上下文分块并生成可点击的页面引用，让模型用 [n] 标注具体段落
  const pageCitations = [];
  if (ctx.page) {
    splitIntoChunks(ctx.page, 1000, 6).forEach((c, i) => {
      pageCitations.push({
        index: i + 1,
        source: 'page',
        title: c.replace(/\s+/g, ' ').trim().slice(0, 40),
        url: ctx.pageUrl || '',
        snippet: c,
      });
    });
    if (pageCitations.length) {
      emit({ type: 'citations', citations: pageCitations });
      userParts.push(
        '当前页面内容（引用具体内容时请用 [n] 标注对应块）：\n' +
          pageCitations.map((c) => '[' + c.index + '] ' + c.snippet).join('\n\n')
      );
    } else {
      userParts.push('当前页面内容（作为背景上下文）：\n' + ctx.page);
    }
  }

  if (instruction) userParts.push('用户指令 / 问题：\n' + instruction);
  if (!userParts.length) userParts.push('（无输入）');
  messages.push({ role: 'user', content: userParts.join('\n\n') });

  for (let iter = 0; iter < budget.maxModelTurns; iter++) {
    if (Date.now() - startedAt >= budget.maxDurationMs) {
      emitState(RUN_STATUS.TIMEOUT, { reason: 'maxDurationMs' });
      emit({ type: 'budget-exceeded', reason: 'maxDurationMs', message: '任务执行超过安全时限，已停止。' });
      emit({ type: 'end' });
      return;
    }
    run.currentStep = iter + 1;
    emitState(iter === 0 ? RUN_STATUS.PLANNING : RUN_STATUS.OBSERVING);
    const step = await streamAgentStep(port, settings, messages, signal, tools, emit);
    if (step.error) {
      emitState(RUN_STATUS.FAILED, { error: step.error });
      emit({ type: 'error', error: step.error });
      return;
    }
    messages.push(step.assistantMessage);

    if (step.toolCalls.length) {
      for (const tc of step.toolCalls) {
        toolCallCount += 1;
        const fingerprint = tc.name + ':' + JSON.stringify(tc.args || {});
        const repeated = (toolFingerprints.get(fingerprint) || 0) + 1;
        toolFingerprints.set(fingerprint, repeated);
        if (toolCallCount > budget.maxToolCalls || repeated > budget.maxSameToolCalls) {
          emit({ type: 'budget-exceeded', reason: repeated > budget.maxSameToolCalls ? 'maxSameToolCalls' : 'maxToolCalls', message: '工具调用达到安全上限，已停止。' });
          emit({ type: 'end' });
          return;
        }
        const callId = tc.id || 'tool-' + iter + '-' + Math.random().toString(36).slice(2, 8);
        const toolState = { callId, name: tc.name, status: TOOL_STATUS.PENDING };
        let res;
        if (settings.toolApproval !== false && toolNeedsApproval(tc.name) && !sessionApprovedTools.has(tc.name)) {
          toolState.status = TOOL_STATUS.APPROVAL_REQUIRED;
          emitState(RUN_STATUS.WAITING_APPROVAL, { callId, tool: tc.name });
          const decision = await waitForToolApproval(port, callId, tc.name, tc.args, signal, runId);
          if (decision === 'session') sessionApprovedTools.add(tc.name);
          if (decision !== 'once' && decision !== 'session') {
            res = { result: '用户未批准执行工具「' + tc.name + '」，请不要执行该操作；可说明原因或给出替代方案。' };
            toolState.status = TOOL_STATUS.REJECTED;
            emit({ type: 'tool-result', callId, name: tc.name, status: 'rejected', result: res.result });
          }
        }
        if (!res) {
          toolState.status = TOOL_STATUS.RUNNING;
          emitState(RUN_STATUS.EXECUTING, { callId, tool: tc.name });
          emit({ type: 'tool-call', callId, name: tc.name, args: tc.args, requiresApproval: false, risk: getToolMetadata(tc.name).risk });
          try {
            res = await withTimeout(() => executeAnyTool(tc.name, tc.args, ctx), budget.toolTimeoutMs, signal);
          } catch (e) {
            res = { result: e.name === 'AbortError' ? '任务已取消。' : e.message, ok: false };
          }
          toolState.status = res.ok === false ? TOOL_STATUS.FAILED : TOOL_STATUS.SUCCEEDED;
          emit({ type: 'tool-result', callId, name: tc.name, status: 'completed', result: res.result });
        }
        if (res.citations) {
          emit({ type: 'citations', citations: res.citations });
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: res.result });
      }
      continue;
    }

    emitState(RUN_STATUS.COMPLETED);
    emit({ type: 'end' });
    return;
  }

  emitState(RUN_STATUS.TIMEOUT, { reason: 'maxModelTurns' });
  emit({ type: 'budget-exceeded', reason: 'maxModelTurns', message: '已达到最大推理轮数，任务已安全停止。' });
  emit({ type: 'chunk', text: '\n\n（已达到安全推理上限，已停止）' });
  emit({ type: 'end' });
}
