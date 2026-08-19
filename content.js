(function () {
  if (window.__kbAiLoaded) return;
  window.__kbAiLoaded = true;

  let host = null;
  let shadow = null;
  let bubble = null;
  let panel = null;
  let panelBody = null;
  let lastText = '';
  let lastResponse = '';
  let port = null;
  let dragState = null;
  let resizeState = null;
  let pageText = '';
  let panelTextEl = null;
  let fab = null;
  let conversation = [];
  let stopBtn = null;
  let streaming = false;
  let pendingAcc = '';
  let pendingAiMsg = null;
  let pendingContentEl = null;
  let pendingStarted = false;
  let pendingParts = [];
  let activeRunId = null;
  let currentCitations = null; // 当前回答的引用来源元数据
  let citeHighlights = []; // 页面内引用高亮的浮层元素数组（绝对定位覆盖，不改动页面 DOM）
  let citeHighlightRange = null;
  let citeHighlightEntered = false;
  const CONV_KEY = 'kbConversation';

  // 提取页面正文，作为指令的上下文
  function extractPageText() {
    try {
      const doc = document.body;
      if (!doc) return '';
      const clone = doc.cloneNode(true);
      clone
        .querySelectorAll(PAGE_TEXT_EXCLUDE)
        .forEach((el) => el.remove());
      let text = clone.innerText || '';
      text = text
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (text.length > 6000) text = text.slice(0, 6000) + '……（页面内容过长，已截断）';
      return text;
    } catch (e) {
      return '';
    }
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; }
    .bubble {
      position: fixed; z-index: 2147483647;
      display: flex; align-items: center; gap: 6px;
      background: #4a90d9; color: #fff; border-radius: 20px;
      padding: 6px 12px; cursor: pointer; user-select: none;
      font-size: 13px; box-shadow: 0 4px 14px rgba(0,0,0,.25);
      transition: background .15s, transform .15s;
      animation: kb-pop .18s ease;
    }
    @keyframes kb-pop { from { transform: scale(.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .bubble:hover { background: #3a7cc4; transform: translateY(-1px); }
    .bubble .dot { width: 6px; height: 6px; border-radius: 50%; background: #fff; animation: kb-blink 1.2s infinite; }
    @keyframes kb-blink { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
    .panel {
      position: fixed; z-index: 2147483647;
      width: 640px; height: auto; min-width: 280px; min-height: 120px;
      max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
      background: #fff; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.28);
      display: flex; flex-direction: column; overflow: hidden;
      animation: kb-pop .18s ease;
    }
    .panel.docked {
      max-height: calc(100vh - 72px);
    }
    .resize-handle {
      position: absolute; right: 0; bottom: 0;
      width: 18px; height: 18px; cursor: nwse-resize;
      user-select: none; touch-action: none; z-index: 5;
    }
    .resize-handle::after {
      content: ''; position: absolute; right: 4px; bottom: 4px;
      width: 9px; height: 9px;
      border-right: 2px solid #c0c4cc; border-bottom: 2px solid #c0c4cc;
      border-radius: 0 0 3px 0;
      transition: border-color .15s;
    }
    .resize-handle:hover::after { border-color: #4a90d9; }
    .panel.dark { background: #26292e; }
    .p-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #f5f6f8; border-bottom: 1px solid #e2e5ea; cursor: grab; }
    .p-head:active { cursor: grabbing; }
    .panel.dark .p-head { background: #2f3339; border-color: #3a3f46; }
    .p-head .logo { width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; }
    .p-head .title { font-size: 13px; font-weight: 600; color: #333; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .panel.dark .p-head .title { color: #e3e5e8; }
    .p-head .close { border: none; background: none; color: #999; font-size: 16px; cursor: pointer; line-height: 1; padding: 2px 4px; border-radius: 4px; }
    .p-head .close:hover { color: #e74c3c; background: rgba(0,0,0,.05); }
    .p-text {
      margin: 6px 12px 0; padding: 4px 10px; font-size: 12px; color: #888; line-height: 1.5;
      max-height: 30px; overflow: auto; border-left: 2px solid #e2e5ea; word-break: break-word;
      user-select: none; flex-shrink: 0;
    }
    .panel.dark .p-text { color: #9aa0a8; border-color: #3a3f46; }
    .p-body { padding: 10px 12px; overflow-y: auto; flex: 1 1 auto; font-size: 13px; line-height: 1.7; color: #333; word-break: break-word; min-height: 0; scrollbar-width: thin; scrollbar-color: #d5d9e0 transparent; }
    .p-body::-webkit-scrollbar { width: 8px; }
    .p-body::-webkit-scrollbar-thumb { background: #d5d9e0; border-radius: 999px; }
    .p-body::-webkit-scrollbar-thumb:hover { background: #b8bec6; }
    .p-body::-webkit-scrollbar-track { background: transparent; }
    .panel.dark .p-body { color: #e3e5e8; scrollbar-color: #3a3f46 transparent; }
    .panel.dark .p-body::-webkit-scrollbar-thumb { background: #3a3f46; }
    .panel.dark .p-body::-webkit-scrollbar-thumb:hover { background: #4a5058; }
    .p-body.loading { color: #999; }
    .panel.dark .p-body.loading { color: #9aa0a8; }
    .p-body.error { color: #e74c3c; }
    .msg { margin-bottom: 14px; max-width: 100%; }
    .msg.user {
      background: linear-gradient(135deg, #4a90d9, #63a0e2); color: #fff;
      border-radius: 12px 12px 4px 12px;
      padding: 8px 14px; margin-left: auto; white-space: pre-wrap;
      width: fit-content;
      box-shadow: 0 2px 8px rgba(74,144,217,.22);
    }
    .msg.ai { background: transparent; padding: 0 2px; margin-right: 6px; }
    .msg.ai .typing { color: #999; }
    .panel.dark .msg.ai .typing { color: #9aa0a8; }
    .typing { display: inline-flex; gap: 4px; align-items: center; }
    .typing span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: kb-bounce 1.2s infinite; }
    .typing span:nth-child(2) { animation-delay: .15s; }
    .typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes kb-bounce { 0%,60%,100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-4px); opacity: 1; } }
    .p-body h1, .p-body h2, .p-body h3, .p-body h4 { margin: 14px 0 8px; line-height: 1.4; font-weight: 700; }
    .p-body h1 { font-size: 17px; } .p-body h2 { font-size: 15.5px; } .p-body h3 { font-size: 14.5px; } .p-body h4 { font-size: 13.5px; }
    .msg.ai > :first-child { margin-top: 2px; }
    .msg.ai > :last-child { margin-bottom: 2px; }
    .p-body p { margin: 8px 0; padding: 0; background: none; border-radius: 0; }
    .p-body ul, .p-body ol { margin: 8px 0; padding-left: 22px; background: none; border-radius: 0; padding-top: 2px; padding-bottom: 2px; }
    .p-body li { margin: 4px 0; }
    .p-body li::marker { color: #4a90d9; }
    .panel.dark .p-body li::marker { color: #6aa5e0; }
    .p-body code { background: rgba(74,144,217,.1); color: #3a7cc4; border-radius: 4px; padding: 1px 6px; font-size: 12px; font-family: Consolas, "Cascadia Code", monospace; }
    .panel.dark .p-body code { background: rgba(110,168,254,.15); color: #9ecbff; }
    .code-wrap { position: relative; margin: 10px 0; border-radius: 10px; background: #171a21; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,.18); }
    .panel.dark .code-wrap { background: #14171d; border: 1px solid #2a2f38; }
    .code-head { display: flex; align-items: center; justify-content: space-between; padding: 5px 12px; background: #232833; }
    .panel.dark .code-head { background: #1d222b; }
    .code-lang { font-size: 11px; color: #8b949e; letter-spacing: .5px; text-transform: uppercase; user-select: none; font-family: Consolas, monospace; }
    .code-wrap pre { background: transparent; padding: 12px 14px; overflow-x: auto; margin: 0; }
    .code-wrap pre code { background: none; padding: 0; color: #d6dce5; font-size: 12px; line-height: 1.7; font-family: Consolas, "Cascadia Code", monospace; }
    .code-copy {
      border: none; background: none; color: #8b949e;
      border-radius: 6px; padding: 2px 8px; font-size: 11px; cursor: pointer;
      font-family: inherit; transition: color .15s, background .15s; line-height: 1.6;
    }
    .code-copy:hover { color: #fff; background: rgba(255,255,255,.08); }
    .code-copy.copied { color: #4ade80; }
    .tk-comment { color: #8b949e; font-style: italic; }
    .tk-string { color: #a5d6ff; }
    .tk-number { color: #79c0ff; }
    .tk-keyword { color: #ff7b72; font-weight: 600; }
    .tk-type { color: #d2a8ff; }
    .tk-fn { color: #d2a8ff; }
    .p-body blockquote {
      background: var(--note-bg, #f2f4f7); border-left: 3px solid #4a90d9;
      padding: 8px 12px; color: #666; margin: 10px 0; border-radius: 0 8px 8px 0;
    }
    .panel.dark .p-body blockquote { background: #2a2e34; color: #b8bec6; }
    .p-body a { color: #4a90d9; text-decoration: none; }
    .p-body a:hover { text-decoration: underline; }
    .p-body strong { font-weight: 700; }
    .p-body hr { border: none; border-top: 1px solid var(--border, #e2e5ea); margin: 14px 0; }
    .panel.dark .p-body hr { border-color: #3a3f46; }
    .md-table-wrap { margin: 10px 0; overflow-x: auto; border: 1px solid var(--border, #d5d9e0); border-radius: 8px; }
    .p-body table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
    .p-body th, .p-body td { padding: 6px 12px; border-bottom: 1px solid var(--border, #e2e5ea); text-align: left; vertical-align: top; }
    .p-body th { background: #f2f4f7; font-weight: 600; }
    .p-body tbody tr:nth-child(even) { background: rgba(0,0,0,.025); }
    .p-body tr:last-child td { border-bottom: none; }
    .panel.dark .md-table-wrap { border-color: #3a3f46; }
    .panel.dark .p-body th { background: #2a2e34; }
    .panel.dark .p-body th, .panel.dark .p-body td { border-color: #3a3f46; }
    .panel.dark .p-body tbody tr:nth-child(even) { background: rgba(255,255,255,.03); }
    .stream-cursor { display: inline-block; width: 7px; height: 13px; margin-left: 3px; vertical-align: -2px; border-radius: 1.5px; background: #4a90d9; animation: kb-cursor .9s steps(2, start) infinite; }
    @keyframes kb-cursor { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
    .msg-actions { display: flex; gap: 2px; margin-top: 6px; opacity: 0; transition: opacity .15s; }
    .msg.ai:hover .msg-actions, .msg-actions:hover { opacity: 1; }
    .msg-actions button {
      border: none; background: none; color: #98a0aa; font-size: 11.5px; cursor: pointer;
      padding: 2px 8px; border-radius: 6px; font-family: inherit;
      display: inline-flex; align-items: center; gap: 4px; transition: all .15s;
    }
    .msg-actions button:hover { background: rgba(0,0,0,.06); color: #4a90d9; }
    .panel.dark .msg-actions button:hover { background: rgba(255,255,255,.08); color: #6aa5e0; }
    .stopped-note { margin-top: 6px; font-size: 11.5px; color: #98a0aa; user-select: none; }
    .p-foot { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid #e2e5ea; }
    .panel.dark .p-foot { border-color: #3a3f46; }
    .p-foot button { border: 1px solid #e2e5ea; background: #fff; color: #555; border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; transition: all .15s; }
    .panel.dark .p-foot button { background: #26292e; border-color: #3a3f46; color: #ccc; }
    .p-foot button:hover { border-color: #4a90d9; color: #4a90d9; }
    .p-foot .spacer { flex: 1; }
    .p-foot .copy-btn { margin-left: auto; }
    .p-foot .stop-btn { border-color: #e74c3c; color: #e74c3c; font-weight: 600; }
    .p-foot .stop-btn:hover { border-color: #e74c3c; color: #fff; background: #e74c3c; }
    .panel.dark .p-foot .stop-btn { border-color: #e74c3c; color: #e74c3c; }
    .panel.dark .p-foot .stop-btn:hover { color: #fff; background: #e74c3c; }
    .cmd-area { padding: 8px 12px; border-top: 1px solid #e2e5ea; flex-shrink: 0; }
    .cmd-box { display: flex; gap: 6px; align-items: stretch; }
    .panel.dark .cmd-area { border-color: #3a3f46; }
    .cmd-input {
      flex: 1; resize: none; border: 1px solid #e2e5ea; border-radius: 8px;
      padding: 6px 10px; font-size: 13px; font-family: inherit; outline: none;
      background: #fff; color: #333; min-height: 34px; max-height: 120px; line-height: 1.5;
    }
    .panel.dark .cmd-input { background: #26292e; border-color: #3a3f46; color: #e3e5e8; }
    .cmd-input:focus { border-color: #4a90d9; box-shadow: 0 0 0 3px rgba(74,144,217,.15); }
    .cmd-send {
      border: 1px solid #4a90d9; background: #4a90d9; color: #fff;
      border-radius: 8px; padding: 0 14px; font-size: 13px; cursor: pointer; font-family: inherit;
      transition: background .15s; flex-shrink: 0;
    }
    .cmd-send:hover { background: #3a7cc4; }
    .cmd-send:disabled { opacity: .5; cursor: not-allowed; }
    .quick-prompts { display: flex; gap: 5px; flex-wrap: wrap; margin: 0 0 7px; }
    .quick-prompt { border: 1px solid #c8d9ec; background: #f5f9fd; color: #3d6f9e; border-radius: 12px; padding: 3px 8px; font-size: 11px; cursor: pointer; }
    .quick-prompt:hover { background: #e5f0fb; }
    .panel.dark .quick-prompt { background: #293746; border-color: #3d5570; color: #9bc5eb; }
    .fab {
      position: fixed; right: 16px; top: 38%; z-index: 2147483646;
      width: 52px; height: 52px; border: 1px solid rgba(255,255,255,.45); border-radius: 50%;
      background: linear-gradient(145deg, #5ba0e5 0%, #3d7fc4 100%);
      color: #fff; display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 700; letter-spacing: .4px; cursor: pointer;
      box-shadow: 0 8px 22px rgba(45,105,165,.36), inset 0 1px 1px rgba(255,255,255,.35);
      transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
      user-select: none;
    }
    .user-turn { width: fit-content; max-width: 96%; margin: 0 0 14px auto; }
    .user-turn .msg { margin-bottom: 3px; }
    .user-actions { display: flex; justify-content: flex-end; align-items: center; opacity: 0; transition: opacity .15s; }
    .user-turn:hover .user-actions, .user-actions:hover { opacity: 1; }
    .user-actions button { border: none; background: none; color: #98a0aa; font-size: 11.5px; cursor: pointer; padding: 2px 7px; border-radius: 6px; font-family: inherit; }
    .user-actions button:hover { background: rgba(0,0,0,.06); color: #4a90d9; }
    .panel.dark .user-actions button:hover { background: rgba(255,255,255,.08); color: #6aa5e0; }
    @media (hover: none) { .msg-actions, .user-actions { opacity: 1; } }
    .fab::before { content: ''; position: absolute; inset: 5px; border: 1px solid rgba(255,255,255,.2); border-radius: 50%; pointer-events: none; }
    .fab::after { content: ''; position: absolute; right: -2px; bottom: 2px; width: 10px; height: 10px; border-radius: 50%; background: #52d38a; border: 2px solid #fff; }
    .fab:hover { transform: translateY(-2px) scale(1.06); filter: saturate(1.08); box-shadow: 0 11px 26px rgba(45,105,165,.46), inset 0 1px 1px rgba(255,255,255,.4); }
    .fab:active { transform: translateY(0) scale(.97); }
    .fab:focus-visible { outline: 3px solid rgba(91,160,229,.45); outline-offset: 3px; }
    .fab img { width: 37px; height: 37px; object-fit: contain; position: relative; z-index: 1; }
    .fab.hidden { display: none; }
    .fab.thinking { animation: fab-pulse 1.2s ease-in-out infinite; }
    @keyframes fab-pulse { 0%,100% { box-shadow: 0 8px 22px rgba(45,105,165,.36), 0 0 0 0 rgba(82,211,138,.35); } 50% { box-shadow: 0 10px 26px rgba(45,105,165,.48), 0 0 0 7px rgba(82,211,138,0); } }
    @media (max-width: 600px) { .fab { right: 12px; width: 46px; height: 46px; font-size: 13px; } }
    @media (prefers-reduced-motion: reduce) { .fab, .bubble { animation: none !important; transition: none !important; } }
    .cite-badge {
      display: inline-flex; align-items: center; gap: 3px;
      background: #eaf3fc; color: #4a90d9; border: 1px solid #b8d4f0;
      border-radius: 10px; padding: 0 7px; margin: 0 2px;
      font-size: 11px; line-height: 1.7; cursor: pointer; user-select: none;
      vertical-align: baseline; transition: all .15s; font-family: inherit;
      max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cite-badge:hover { background: #4a90d9; color: #fff; border-color: #4a90d9; }
    .cite-badge .cite-idx { font-weight: 700; flex-shrink: 0; }
    .panel.dark .cite-badge { background: #2b3644; border-color: #3d5570; color: #7db4e8; }
    .panel.dark .cite-badge:hover { background: #4a90d9; border-color: #4a90d9; color: #fff; }
    .cite-sources {
      margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border, #d5d9e0);
      display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
    }
    .cite-sources .cite-label { font-size: 11px; color: #999; margin-right: 2px; }
    .panel.dark .cite-sources { border-color: #3a3f46; }
    .panel.dark .cite-sources .cite-label { color: #8b949e; }
    .agent-steps { display: flex; flex-direction: column; gap: 4px; margin: 2px 0 8px; }
    .agent-step {
      font-size: 11.5px; line-height: 1.5; color: #7a8694;
      background: rgba(74,144,217,.08); border-left: 2px solid #4a90d9;
      padding: 4px 8px; border-radius: 0 6px 6px 0; word-break: break-word;
    }
    .panel.dark .agent-step { background: rgba(110,168,254,.12); color: #9aa6b3; }
    .agent-tool { font-weight: 600; color: #4a90d9; }
    .panel.dark .agent-tool { color: #7db4e8; }
    .agent-tool-arg { color: inherit; opacity: .85; }
    .agent-content { min-height: 1px; }
    .tool-approval { margin: 5px 0; padding: 8px; border: 1px solid #f0b35b; border-radius: 8px; background: #fff8ea; font-size: 12px; color: #6e4b13; }
    .tool-approval-title { font-weight: 600; margin-bottom: 5px; }
    .tool-approval-actions { display: flex; gap: 6px; }
    .tool-approval button { border: 0; border-radius: 5px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
    .tool-approve { color: #fff; background: #3b82f6; }
    .tool-approve-session { color: #fff; background: #2d9d78; }
    .tool-reject { color: #6b7280; background: #e5e7eb; }
    .panel.dark .tool-approval { background: #3a321f; border-color: #866323; color: #efd59a; }
  `;

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = '__kb-ai-host';
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.left = '0';
    host.style.top = '0';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    fab = document.createElement('button');
    fab.className = 'fab';
    const fabIcon = document.createElement('img');
    fabIcon.src = chrome.runtime.getURL('icons/recallflow-mark.svg');
    fabIcon.alt = '';
    fab.appendChild(fabIcon);
    fab.title = 'RecallFlow';
    fab.setAttribute('aria-label', '打开 RecallFlow');
    fab.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });
    fab.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    shadow.appendChild(fab);

    document.documentElement.appendChild(host);
  }

  function removeBubble() {
    if (bubble) {
      bubble.remove();
      bubble = null;
    }
  }

  function removePanel() {
    closePort();
    clearCiteHighlight();
    if (panel) {
      panel.remove();
      panel = null;
      panelBody = null;
      panelTextEl = null;
      if (fab) fab.classList.remove('hidden');
    }
  }

  function closePort() {
    if (port) {
      try {
        port.disconnect();
      } catch (e) {}
      port = null;
    }
  }

  function showBubble(x, y) {
    removeBubble();
    removePanel();
    bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = '<span class="dot"></span><span>RecallFlow</span>';
    bubble.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    bubble.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(x, y);
    });
    shadow.appendChild(bubble);
    const r = bubble.getBoundingClientRect();
    const left = Math.min(Math.max(4, x), window.innerWidth - r.width - 4);
    const top = y - r.height - 8 > 4 ? y - r.height - 8 : y + 12;
    bubble.style.left = left + 'px';
    bubble.style.top = top + 'px';
  }

  function togglePanel() {
    if (panel) {
      removePanel();
    } else {
      ensureHost();
      lastText = '';
      pageText = pageContextEnabled ? extractPageText() : '';
      openPanel(0, 0, true);
    }
  }

  // 根据内容自动调整面板高度
  function fitPanelHeight() {
    if (!panel || !panelBody) return;
    if (panel._manualSize) return;
    const maxH = Math.max(120, window.innerHeight - (panel.classList.contains('docked') ? 80 : 24));
    panel.style.height = 'auto';
    panelBody.style.height = 'auto';
    panelBody.style.flex = '';
    panelBody.style.overflowY = 'auto';
    let chromeH = 0;
    for (const child of panel.children) {
      if (child !== panelBody && !child.classList.contains('resize-handle')) chromeH += child.offsetHeight;
    }
    const bodyNatH = panelBody.scrollHeight;
    // 快捷语句、输入区与底栏属于固定区域，优先为它们预留高度；
    // 仅压缩可滚动的对话内容，避免底部“清空对话”被裁掉。
    const bodyAvailableH = Math.max(0, maxH - chromeH);
    const bodyH = Math.min(bodyNatH, bodyAvailableH);
    panelBody.style.flex = 'none';
    panelBody.style.height = bodyH + 'px';
    panelBody.style.overflowY = bodyNatH > bodyH ? 'auto' : 'hidden';
    const totalH = Math.min(maxH, Math.max(120, chromeH + bodyH));
    panel.style.height = totalH + 'px';
    if (panel.classList.contains('docked') && !panel._manualPos) {
      const h = panel.offsetHeight;
      const anchorTop = window.innerHeight * 0.38;
      panel.style.top = Math.max(8, Math.min(anchorTop, window.innerHeight - h - 8)) + 'px';
    }
  }

  // ---- 轻量语法高亮 ----
  const HL_KEYWORDS = new Set(
    'function return if else for while do switch case break continue default new class extends super this const let var typeof instanceof in of try catch finally throw async await yield import export from as static get set null undefined true false void delete package private protected public interface type enum namespace module def elif lambda pass None True False and or not global raise with assert import print del class return if elif else'.split(' ')
  );
  const HL_TYPES = new Set('String Number Boolean Array Object Function Promise Error Date RegExp Map Set Symbol BigInt Math JSON Console Node Buffer parseInt parseFloat isNaN isFinite JSON.stringify JSON.parse'.split(' '));

  function hlEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 简单分块高亮：注释 / 字符串 / 关键字 / 数字 / 函数名 / 类型
  function highlightCode(code) {
    const esc = hlEscape(code);
    const tokens = [];

    // 组合正则，一次遍历
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(\d+\.\d+|\d+\.?)\b|([A-Za-z_$][\w$]*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(esc))) {
      if (m.index > last) tokens.push(esc.slice(last, m.index));
      if (m[1]) tokens.push('<span class="tk-comment">' + m[1] + '</span>');
      else if (m[2]) tokens.push('<span class="tk-string">' + m[2] + '</span>');
      else if (m[3]) tokens.push('<span class="tk-number">' + m[3] + '</span>');
      else if (m[4]) {
        const w = m[4];
        if (HL_KEYWORDS.has(w)) tokens.push('<span class="tk-keyword">' + w + '</span>');
        else if (HL_TYPES.has(w)) tokens.push('<span class="tk-type">' + w + '</span>');
        else {
          // 函数名：后面紧跟 (
          const after = esc.slice(m.index + w.length, m.index + w.length + 1);
          if (after === '(') tokens.push('<span class="tk-fn">' + w + '</span>');
          else tokens.push(w);
        }
      }
      last = m.index + m[0].length;
    }
    if (last < esc.length) tokens.push(esc.slice(last));
    return tokens.join('');
  }

  // AI 回复底部操作栏（元宝风格：复制等）
  function msgActionsHtml() {
    return '<div class="msg-actions"><button class="act-copy" title="复制回答内容">⧉ 复制</button></div>';
  }

  function userActionsHtml(index) {
    return '<div class="user-actions"><button class="act-rewind" data-turn-index="' + index + '" title="撤销这条指令及其后续对话">↶ 撤销</button><button class="act-user-copy" title="复制这条指令">⧉ 复制</button></div>';
  }

  // ---- Markdown 渲染 ----
  // citations：可选，传入引用元数据数组后，[n] 会渲染为可点击的引用徽章
  // streaming：是否处于流式输出中（为 true 时末尾追加闪烁光标）
  function renderMarkdown(md, citations, streaming) {
    const lines = md.split('\n');
    let html = '';
    let inCode = false;
    let codeBuf = [];
    let codeLang = '';
    let listType = null;
    let tableBuf = null;

    const escInline = (s) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const escAttr = (s) =>
      String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    const inline = (s) => {
      let r = escInline(s);
      r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
      r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      r = r.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
      r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
      // 将 [n] 渲染为可点击的引用徽章（仅当存在引用元数据时）
      if (citations && citations.length) {
        r = r.replace(/\[(\d{1,2})\]/g, (match, num) => {
          const idx = parseInt(num, 10);
          const c = citations.find((x) => x.index === idx);
          if (!c) return match;
          const short = c.title.length > 16 ? c.title.slice(0, 16) + '…' : c.title;
          return (
            '<button class="cite-badge" data-cite-id="' + escAttr(c.id || '') + '" data-cite-source="' + escAttr(c.source || 'kb') + '" data-cite-url="' + escAttr(c.url || '') + '" data-cite-snippet="' + escAttr(c.snippet || '') + '" title="打开证据：' + escAttr(c.title) + '">' +
            '<span class="cite-idx">[' + idx + ']</span>' + escAttr(short) + '</button>'
          );
        });
      }
      return r;
    };

    const flushList = () => {
      if (listType) {
        html += '</' + listType + '>';
        listType = null;
      }
    };

    const isTableSep = (l) => /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && l.includes('-') && l.includes('|');
    const parseRow = (r) => {
      let t = r.trim();
      if (t.startsWith('|')) t = t.slice(1);
      if (t.endsWith('|')) t = t.slice(0, -1);
      return t.split('|').map((c) => c.trim());
    };
    const flushTable = () => {
      if (!tableBuf) return;
      const head = parseRow(tableBuf[0]);
      const rows = tableBuf.slice(2);
      html +=
        '<div class="md-table-wrap"><table><thead><tr>' +
        head.map((c) => '<th>' + inline(c) + '</th>').join('') +
        '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + parseRow(r).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>';
      tableBuf = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      if (line.trim().startsWith('```')) {
        if (inCode) {
          html +=
            '<div class="code-wrap"><div class="code-head"><span class="code-lang">' +
            (codeLang ? escAttr(codeLang) : 'code') +
            '</span><button class="code-copy">复制</button></div><pre><code>' +
            highlightCode(codeBuf.join('\n')) + '</code></pre></div>';
          codeBuf = [];
          inCode = false;
          codeLang = '';
        } else {
          flushList();
          flushTable();
          inCode = true;
          codeLang = line.trim().slice(3).trim();
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }
      // 表格：当前行含 | 且下一行是分隔行时开始收集
      if (tableBuf) {
        if (line.trim() !== '' && line.includes('|')) {
          tableBuf.push(line);
          continue;
        }
        flushTable();
      } else if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushList();
        tableBuf = [line, lines[i + 1]];
        i++;
        continue;
      }
      // 分割线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushList();
        flushTable();
        html += '<hr>';
        continue;
      }
      const mH = line.match(/^(#{1,4})\s+(.*)/);
      if (mH) {
        flushList();
        flushTable();
        const lv = mH[1].length;
        html += '<h' + lv + '>' + inline(mH[2]) + '</h' + lv + '>';
        continue;
      }
      const mUl = line.match(/^\s*[-*+]\s+(.*)/);
      if (mUl) {
        flushTable();
        if (listType !== 'ul') {
          flushList();
          html += '<ul>';
          listType = 'ul';
        }
        html += '<li>' + inline(mUl[1]) + '</li>';
        continue;
      }
      const mOl = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (mOl) {
        flushTable();
        if (listType !== 'ol') {
          flushList();
          html += '<ol>';
          listType = 'ol';
        }
        html += '<li>' + inline(mOl[1]) + '</li>';
        continue;
      }
      const mBq = line.match(/^\s*>\s?(.*)/);
      if (mBq) {
        flushList();
        flushTable();
        // 合并连续的引用行
        const buf = [mBq[1]];
        while (i + 1 < lines.length) {
          const m2 = lines[i + 1].replace(/\r$/, '').match(/^\s*>\s?(.*)/);
          if (!m2) break;
          buf.push(m2[1]);
          i++;
        }
        html += '<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>';
        continue;
      }
      flushList();
      flushTable();
      if (line.trim() === '') {
        continue;
      }
      html += '<p>' + inline(line) + '</p>';
    }
    flushList();
    flushTable();
    if (streaming) {
      if (html.endsWith('</p>')) {
        html = html.slice(0, -4) + '<span class="stream-cursor"></span></p>';
      } else {
        html += '<p><span class="stream-cursor"></span></p>';
      }
    }
    return html || '<p>（无内容）</p>';
  }

  // ---- 面板：自由指令 + 流式输出 ----
  function saveConversation() {
    try {
      const list = conversation.slice(-20);
      chrome.storage.local.set({ [CONV_KEY]: { url: location.href, list, ts: Date.now() } });
    } catch (e) {}
  }

  function loadConversation() {
    return new Promise((resolve) => {
      chrome.storage.local.get(CONV_KEY, (d) => {
        const c = d[CONV_KEY];
        if (c && c.url === location.href && Array.isArray(c.list)) {
          conversation = c.list;
        } else {
          conversation = [];
        }
        resolve();
      });
    });
  }

  function renderConversation() {
    if (!panelBody) return;
    if (!conversation.length) {
      panelBody.className = 'p-body';
      panelBody.innerHTML = '<div class="msg ai">' + (lastText ? '输入指令，AI 将基于选中文本执行。' : '输入指令，AI 将直接执行（可基于知识库）。') + '</div>';
      return;
    }
    // 渲染引用来源区域
    const citeSourcesHtml = (cites) => {
      if (!cites || !cites.length) return '';
      return (
        '<div class="cite-sources"><span class="cite-label">参考来源：</span>' +
        cites
          .map(
            (c) =>
              '<button class="cite-badge" data-cite-id="' + escAttr(c.id || '') + '" data-cite-source="' + escAttr(c.source || 'kb') + '" data-cite-url="' + escAttr(c.url || '') + '" data-cite-snippet="' + escAttr(c.snippet || '') + '" title="打开证据：' + escAttr(c.title) + '">' +
              '<span class="cite-idx">[' + c.index + ']</span>' + escAttr(c.title.length > 18 ? c.title.slice(0, 18) + '…' : c.title) + '</button>'
          )
          .join('') +
        '</div>'
      );
    };
    const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    panelBody.className = 'p-body';
    panelBody.innerHTML = conversation
      .map((m, index) => {
        if (m.role === 'user') {
          return '<div class="user-turn"><div class="msg user">' + escHtml(m.content) + '</div>' + userActionsHtml(index) + '</div>';
        }
        const parts = Array.isArray(m.parts) ? m.parts : [];
        const toolSteps = parts
          .filter((p) => p.type === 'tool-call' || p.type === 'tool-result')
          .map((p) => '<div class="agent-step">' + (p.type === 'tool-call' ? '🔧 ' : p.status === 'completed' ? '✓ 完成：' : '— 未执行：') + escHtml(p.name) + '</div>')
          .join('');
        return '<div class="msg ai"><div class="agent-steps">' + toolSteps + '</div>' + renderMarkdown(m.content || '', m.citations) + citeSourcesHtml(m.citations) + (m.content ? msgActionsHtml() : '') + '</div>';
      })
      .join('');
    // 关联原始文本，供操作栏复制使用
    const aiEls = panelBody.querySelectorAll('.msg.ai');
    let aiIdx = 0;
    for (const m of conversation) {
      if (m.role === 'user') continue;
      if (aiEls[aiIdx]) aiEls[aiIdx]._raw = m.content || '';
      aiIdx++;
    }
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- 页面内引用定位与高亮 ----
  const PAGE_TEXT_EXCLUDE =
    'script,style,noscript,iframe,svg,canvas,nav,header,footer,aside,form,button,input,select,textarea,[contenteditable],.ad,.ads,.advertisement,.banner,[class*=cookie],[id*=cookie],[class*=popup],[class*=modal],#__kb-ai-host';

  function normalizeCitationText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isCitationTextNode(node) {
    const parent = node && node.parentElement;
    if (!parent || parent.closest(PAGE_TEXT_EXCLUDE)) return false;
    try {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    } catch (e) {}
    return true;
  }
  function clearCiteHighlight() {
    citeHighlights.forEach((el) => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    citeHighlights = [];
    citeHighlightRange = null;
    citeHighlightEntered = false;
  }

  function isPointerInCitationRange(event) {
    if (!citeHighlightRange) return false;
    try {
      return Array.prototype.some.call(citeHighlightRange.getClientRects(), (rect) =>
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      );
    } catch (e) {
      return false;
    }
  }

  // 把页面所有可见文本节点按「去除所有空白」拼接成扁平文本，并记录每个字符对应的
  // (节点, 偏移)。这样无论 innerText 与 DOM 在换行/空格/内联元素拆分上的差异，
  // 都能用子串查找精确定位。跳过脚本/样式/代码块，避免误匹配到代码。
  function buildPageCharMap() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    const charNode = [];
    const charOffset = [];
    let text = '';
    while ((n = walker.nextNode())) {
      if (!isCitationTextNode(n)) continue;
      const v = n.nodeValue || '';
      for (let i = 0; i < v.length; i++) {
        if (/\s/.test(v[i])) continue;
        text += v[i];
        charNode.push(n);
        charOffset.push(i);
      }
    }
    return { text, charNode, charOffset };
  }

  function rangeFromCharMap(start, length, map) {
    if (length <= 0 || start + length > map.text.length) return null;
    const sNode = map.charNode[start];
    const sOff = map.charOffset[start];
    const eNode = map.charNode[start + length - 1];
    const eOff = map.charOffset[start + length - 1] + 1;
    const range = document.createRange();
    range.setStart(sNode, sOff);
    range.setEnd(eNode, eOff);
    return range;
  }

  // 用「去除空白后的子串」在页面中查找引用片段，返回 Range（可跨节点）
  function findRangeBySubstr(map, snippet) {
    const q = normalizeCitationText(snippet).replace(/\s+/g, '');
    if (!q) return null;

    const findAll = (needle) => {
      const indexes = [];
      let from = 0;
      while (needle.length >= 10) {
        const at = map.text.indexOf(needle, from);
        if (at < 0) break;
        indexes.push(at);
        from = at + 1;
      }
      return indexes;
    };

    // 片段较长时，首尾同时命中才视为同一证据块，避免跳到相同开头的段落。
    if (q.length >= 120) {
      const prefix = q.slice(0, 120);
      const suffix = q.slice(-100);
      for (const start of findAll(prefix)) {
        const endStart = map.text.indexOf(suffix, start + prefix.length);
        if (endStart >= 0 && endStart - start <= q.length + 240) {
          return rangeFromCharMap(start, endStart + suffix.length - start, map);
        }
      }
    }

    // 依次尝试：整段 → 前缀/中段/后缀窗口（80 字符），提升含代码块的片段的命中率
    const candidates = [q];
    if (q.length > 80) {
      candidates.push(q.slice(0, 80));
      candidates.push(q.slice(Math.floor(q.length / 2), Math.floor(q.length / 2) + 80));
      candidates.push(q.slice(-80));
    }
    for (const cand of candidates) {
      if (cand.length < 10) continue;
      const indexes = findAll(cand);
      if (indexes.length) return rangeFromCharMap(indexes[0], cand.length, map);
    }
    // 前缀逐级缩短回退
    for (let len = Math.min(q.length, 80); len >= 10; len = Math.floor(len * 0.6)) {
      const sub = q.slice(0, len);
      const j = map.text.indexOf(sub);
      if (j >= 0) return rangeFromCharMap(j, sub.length, map);
    }
    return null;
  }

  // 用绝对定位的浮层覆盖匹配文本，不改动页面 DOM（无空行、无列表编号/代码结构破坏）
  function overlayRange(range) {
    const overlays = [];
    const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
    const color = dark ? 'rgba(255,196,0,.42)' : 'rgba(255,196,0,.5)';
    const sx = window.scrollX || 0;
    const sy = window.scrollY || 0;
    let rects;
    try {
      rects = Array.prototype.slice.call(range.getClientRects());
    } catch (e) {
      rects = [];
    }
    for (const r of rects) {
      if (r.width <= 0 || r.height <= 0) continue;
      const d = document.createElement('div');
      d.style.cssText =
        'position:absolute;left:' + (r.left + sx) + 'px;top:' + (r.top + sy) + 'px;' +
        'width:' + r.width + 'px;height:' + r.height + 'px;' +
        'background-color:' + color + ';border-radius:2px;pointer-events:none;z-index:2147483646;';
      document.body.appendChild(d);
      overlays.push(d);
    }
    return overlays;
  }

  // 在页面中查找引用片段并高亮精确匹配的文本，滚动到该位置
  function findAndHighlightCitation(snippet) {
    clearCiteHighlight();

    let range = null;
    try {
      range = findRangeBySubstr(buildPageCharMap(), snippet);
    } catch (e) {
      logError('citation locate failed', e);
    }
    if (!range) return false;

    try {
      citeHighlights = overlayRange(range);
      citeHighlightRange = range;
      citeHighlightEntered = false;
    } catch (e) {
      logError('citation overlay failed', e);
    }

    const rect = range.getBoundingClientRect();
    if (rect && rect.height) {
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * 0.38), behavior: 'smooth' });
    } else {
      const el = range.startContainer.parentElement;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return true;
  }

  function openPanel(x, y, docked) {
    removeBubble();
    removePanel();
    if (fab) fab.classList.add('hidden');

    panel = document.createElement('div');
    panel.className = 'panel';
    if (docked) panel.classList.add('docked');

    const head = document.createElement('div');
    head.className = 'p-head';
    const logo = document.createElement('img');
    logo.className = 'logo';
    logo.src = chrome.runtime.getURL('icons/recallflow-mark.svg');
    logo.alt = 'RecallFlow';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = 'RecallFlow';
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '✕';
    close.addEventListener('click', removePanel);
    head.appendChild(logo);
    head.appendChild(title);
    head.appendChild(close);
    panel.appendChild(head);

    if (lastText) {
      const text = document.createElement('div');
      text.className = 'p-text';
      text.textContent = lastText.length > 200 ? lastText.slice(0, 200) + '…' : lastText;
      text.title = lastText;
      panelTextEl = text;
      panel.appendChild(text);
    }

    panelBody = document.createElement('div');
    panelBody.className = 'p-body';
    panelBody.addEventListener('click', (e) => {
      const rewind = e.target.closest('.act-rewind');
      if (rewind) {
        if (streaming) return;
        const index = Number(rewind.getAttribute('data-turn-index'));
        if (Number.isInteger(index) && conversation[index] && conversation[index].role === 'user') {
          conversation = conversation.slice(0, index);
          saveConversation();
          renderConversation();
          fitPanelHeight();
          panelBody.scrollTop = panelBody.scrollHeight;
        }
        return;
      }
      const userCopy = e.target.closest('.act-user-copy');
      if (userCopy) {
        const turn = userCopy.closest('.user-turn');
        const msgEl = turn && turn.querySelector('.msg.user');
        if (msgEl) navigator.clipboard.writeText(msgEl.textContent || '').then(() => {
          userCopy.textContent = '✓ 已复制';
          setTimeout(() => (userCopy.textContent = '⧉ 复制'), 1200);
        });
        return;
      }
      const actBtn = e.target.closest('.act-copy');
      if (actBtn) {
        const msgEl = actBtn.closest('.msg');
        const raw = msgEl && msgEl._raw;
        if (raw) {
          navigator.clipboard.writeText(raw).then(() => {
            actBtn.textContent = '✓ 已复制';
            setTimeout(() => (actBtn.textContent = '⧉ 复制'), 1200);
          });
        }
        return;
      }
      const btn = e.target.closest('.code-copy');
      if (btn) {
        const wrap = btn.closest('.code-wrap');
        const codeEl = wrap && wrap.querySelector('code');
        if (!codeEl) return;
        navigator.clipboard.writeText(codeEl.textContent || '').then(() => {
          btn.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = '复制';
            btn.classList.remove('copied');
          }, 1200);
        });
        return;
      }
      // 引用徽章点击：跳转到对应位置并高亮
      const cite = e.target.closest('.cite-badge');
      if (cite) {
        const id = cite.getAttribute('data-cite-id');
        const source = cite.getAttribute('data-cite-source');
        const url = cite.getAttribute('data-cite-url');
        if (source === 'page') {
          const snippet = cite.getAttribute('data-cite-snippet') || '';
          findAndHighlightCitation(snippet);
        } else if (url) {
          window.open(url, '_blank', 'noopener');
        } else if (id) {
          chrome.runtime.sendMessage({ type: 'openManager', focusId: id });
        }
      }
    });
    panel.appendChild(panelBody);

    loadConversation().then(() => {
      renderConversation();
      fitPanelHeight();
      panelBody.scrollTop = panelBody.scrollHeight;
    });

    const cmdArea = document.createElement('div');
    cmdArea.className = 'cmd-area';
    const approvalArea = document.createElement('div');
    approvalArea.className = 'tool-approval';
    approvalArea.style.display = 'none';
    cmdArea.appendChild(approvalArea);
    const quickWrap = document.createElement('div');
    quickWrap.className = 'quick-prompts';
    cmdArea.appendChild(quickWrap);
    const cmdWrap = document.createElement('div');
    cmdWrap.className = 'cmd-box';
    const cmdInput = document.createElement('textarea');
    cmdInput.className = 'cmd-input';
    cmdInput.rows = 1;
    cmdInput.placeholder = '输入指令后回车，如：翻译成中文 / 解释这段代码 / 优化并补全…';
    const sendBtn = document.createElement('button');
    sendBtn.className = 'cmd-send';
    sendBtn.textContent = '发送';
    cmdWrap.appendChild(cmdInput);
    cmdWrap.appendChild(sendBtn);
    cmdArea.appendChild(cmdWrap);
    panel.appendChild(cmdArea);

    getAISettings().then((s) => {
      quickWrap.innerHTML = '';
      (s.quickPrompts || AI_SETTINGS_DEFAULTS.quickPrompts || []).slice(0, 12).forEach((prompt) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'quick-prompt';
        b.textContent = prompt;
        b.addEventListener('click', () => {
          if (streaming) return;
          run(prompt);
        });
        quickWrap.appendChild(b);
      });
      fitPanelHeight();
    });

    const foot = document.createElement('div');
    foot.className = 'p-foot';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空对话';
    clearBtn.addEventListener('click', () => {
      conversation = [];
      saveConversation();
      renderConversation();
      fitPanelHeight();
    });
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = '复制';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(panelBody.textContent || '').then(() => {
        copyBtn.textContent = '已复制';
        setTimeout(() => (copyBtn.textContent = '复制'), 1200);
      });
    });
    stopBtn = document.createElement('button');
    stopBtn.className = 'stop-btn';
    stopBtn.textContent = '■ 停止';
    stopBtn.style.display = 'none';
    stopBtn.addEventListener('click', interrupt);
    foot.appendChild(clearBtn);
    foot.appendChild(copyBtn);
    foot.appendChild(stopBtn);
    panel.appendChild(foot);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      panel._manualSize = true;
      resizeState = {
        startX: e.clientX,
        startY: e.clientY,
        origWidth: panel.offsetWidth,
        origHeight: panel.offsetHeight,
      };
    });
    panel.appendChild(resizeHandle);

    shadow.appendChild(panel);

    const prw = panel.offsetWidth;
    const prh = panel.offsetHeight;
    if (docked) {
      panel.style.right = '8px';
      panel.style.left = 'auto';
      const anchorTop = window.innerHeight * 0.38;
      panel.style.top = Math.max(8, Math.min(anchorTop, window.innerHeight - prh - 8)) + 'px';
    } else {
      panel.style.right = 'auto';
      const left = Math.min(Math.max(4, x), window.innerWidth - prw - 4);
      const top = Math.min(Math.max(4, y), window.innerHeight - Math.min(prh, window.innerHeight - 24) - 4);
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    }

    function endStream() {
      streaming = false;
      if (stopBtn) stopBtn.style.display = 'none';
      if (sendBtn) sendBtn.disabled = false;
      pendingAiMsg = null;
      pendingContentEl = null;
      pendingStarted = false;
      pendingAcc = '';
      pendingParts = [];
    }

    function interrupt() {
      if (!streaming) return;
      const acc = pendingAcc;
      closePort();
        if (pendingAiMsg && pendingAiMsg.parentNode) {
          if (acc) {
            lastResponse = acc;
            if (pendingContentEl) pendingContentEl.innerHTML = renderMarkdown(acc, currentCitations, false);
            pendingAiMsg._raw = acc;
            conversation.push({ role: 'assistant', content: acc });
            saveConversation();
            const note = document.createElement('div');
            note.className = 'stopped-note';
            note.textContent = '· 已停止生成';
            pendingAiMsg.appendChild(note);
            pendingAiMsg.insertAdjacentHTML('beforeend', msgActionsHtml());
          } else {
          if (pendingContentEl) {
            pendingContentEl.textContent = '（已停止）';
            pendingContentEl.style.color = '#999';
          }
        }
      }
      endStream();
      fitPanelHeight();
      panelBody.scrollTop = panelBody.scrollHeight;
    }

    function run(instruction) {
      closePort();
      activeRunId = 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      lastResponse = '';
      conversation.push({ role: 'user', content: instruction });
      const userMsg = document.createElement('div');
      userMsg.className = 'user-turn';
      userMsg.innerHTML = '<div class="msg user">' + escHtml(instruction) + '</div>' + userActionsHtml(conversation.length - 1);
      const aiMsg = document.createElement('div');
      aiMsg.className = 'msg ai';
      const stepsEl = document.createElement('div');
      stepsEl.className = 'agent-steps';
      const contentEl = document.createElement('div');
      contentEl.className = 'agent-content';
      contentEl.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
      aiMsg.appendChild(stepsEl);
      aiMsg.appendChild(contentEl);
      panelBody.appendChild(userMsg);
      panelBody.appendChild(aiMsg);
      fitPanelHeight();
      panelBody.scrollTop = panelBody.scrollHeight;

      pendingAcc = '';
      pendingAiMsg = aiMsg;
      pendingContentEl = contentEl;
      pendingStarted = false;
      streaming = true;
      if (stopBtn) stopBtn.style.display = '';
      if (sendBtn) sendBtn.disabled = true;

      port = chrome.runtime.connect({ name: 'ai-stream' });
      const conn = port;
      conn.onMessage.addListener((resp) => {
        if (resp.runId && resp.runId !== activeRunId) return;
        if (resp.type === 'citations') {
          currentCitations = resp.citations || null;
        } else if (resp.type === 'tool-call') {
          pendingParts.push({ type: 'tool-call', callId: resp.callId, name: resp.name, args: resp.args || {}, risk: resp.risk || 'unknown' });
          const step = document.createElement('div');
          step.className = 'agent-step';
          const argStr = resp.args && resp.args.query ? resp.args.query : resp.args && resp.args.id ? resp.args.id : '';
          step.innerHTML =
            '<span class="agent-tool">🔧 ' + escHtml(resp.name) + '</span>' +
            (argStr ? '<span class="agent-tool-arg">：' + escHtml(argStr) + '</span>' : '');
          stepsEl.appendChild(step);
          if (resp.requiresApproval) {
            const detail = resp.args && Object.keys(resp.args).length ? ' 参数：' + JSON.stringify(resp.args) : '';
            approvalArea.innerHTML =
              '<div class="tool-approval-title">此操作需要你的确认</div>' +
              '<div>Agent 请求执行 <b>' + escHtml(resp.name) + '</b>' + escHtml(detail) + '</div>' +
              '<div class="tool-approval-actions"><button class="tool-approve">允许一次</button><button class="tool-approve-session">之后允许</button><button class="tool-reject">拒绝</button></div>';
            approvalArea.style.display = '';
            const decide = (decision) => {
              conn.postMessage({ type: 'tool-approval', callId: resp.callId, decision });
              approvalArea.style.display = 'none';
              approvalArea.innerHTML = '';
            };
            approvalArea.querySelector('.tool-approve').addEventListener('click', () => decide('once'));
            approvalArea.querySelector('.tool-approve-session').addEventListener('click', () => decide('session'));
            approvalArea.querySelector('.tool-reject').addEventListener('click', () => decide('reject'));
          }
          fitPanelHeight();
          panelBody.scrollTop = panelBody.scrollHeight;
        } else if (resp.type === 'tool-result') {
          pendingParts.push({ type: 'tool-result', callId: resp.callId, name: resp.name, status: resp.status, result: resp.result || '' });
          const step = document.createElement('div');
          step.className = 'agent-step';
          step.textContent = resp.status === 'completed' ? '✓ 工具已完成：' + resp.name : '— 工具未执行：' + resp.name;
          stepsEl.appendChild(step);
          fitPanelHeight();
          panelBody.scrollTop = panelBody.scrollHeight;
        } else if (resp.type === 'chunk') {
          pendingAcc += resp.text;
          if (!pendingStarted) {
            pendingStarted = true;
            contentEl.innerHTML = '';
          }
          contentEl.innerHTML = renderMarkdown(pendingAcc, currentCitations, true);
          aiMsg._raw = pendingAcc;
          fitPanelHeight();
          panelBody.scrollTop = panelBody.scrollHeight;
        } else if (resp.type === 'end') {
          lastResponse = pendingAcc || '';
          if (!pendingStarted) {
            contentEl.textContent = '（无返回内容）';
          } else {
            contentEl.innerHTML = renderMarkdown(lastResponse, currentCitations, false);
            aiMsg._raw = lastResponse;
          }
          // 附加引用来源区域
          if (currentCitations && currentCitations.length) {
            const srcWrap = document.createElement('div');
            srcWrap.className = 'cite-sources';
            srcWrap.innerHTML =
              '<span class="cite-label">参考来源：</span>' +
              currentCitations
                .map((c) => {
                  const t = c.title.length > 18 ? c.title.slice(0, 18) + '…' : c.title;
                  const idAttr = String(c.id).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                  const tAttr = String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
                  const titleAttr = String(c.title).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
                  const sourceAttr = String(c.source || 'kb').replace(/"/g, '&quot;');
                  const urlAttr = String(c.url || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                  const snippetAttr = String(c.snippet || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
                  return '<button class="cite-badge" data-cite-id="' + idAttr + '" data-cite-source="' + sourceAttr + '" data-cite-url="' + urlAttr + '" data-cite-snippet="' + snippetAttr + '" title="打开证据：' + titleAttr + '"><span class="cite-idx">[' + c.index + ']</span>' + tAttr + '</button>';
                })
                .join('');
            aiMsg.appendChild(srcWrap);
          }
          if (lastResponse) aiMsg.insertAdjacentHTML('beforeend', msgActionsHtml());
          pendingParts.push({ type: 'text', text: lastResponse });
          conversation.push({ role: 'assistant', content: lastResponse, citations: currentCitations, parts: pendingParts });
          saveConversation();
          fitPanelHeight();
          currentCitations = null;
          endStream();
          closePort();
        } else if (resp.type === 'error') {
          contentEl.textContent = resp.error;
          contentEl.style.color = '#e74c3c';
          if (resp.needSetup) {
            const go = document.createElement('button');
            go.textContent = '打开设置';
            go.style.cssText =
              'margin-left:8px;border:1px solid #4a90d9;color:#4a90d9;background:none;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px;';
            go.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openOptions' }));
            aiMsg.appendChild(document.createElement('br'));
            aiMsg.appendChild(go);
          }
          endStream();
          closePort();
        }
      });
      conn.onDisconnect.addListener(() => {
        if (port === conn) port = null;
        if (port === null && streaming) endStream();
      });
      conn.postMessage({
        action: 'agent',
        runId: activeRunId,
        question: instruction,
        text: lastText,
        page: pageText,
        pageUrl: location.href,
        pageTitle: document.title,
        history: conversation.slice(0, -1),
      });
    }

    function send() {
      if (streaming) return;
      const cmd = cmdInput.value.trim();
      if (!cmd) return;
      run(cmd);
      cmdInput.value = '';
      cmdInput.style.height = 'auto';
      cmdInput.style.height = '34px';
      cmdInput.focus();
    }

    sendBtn.addEventListener('click', send);
    cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        removePanel();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    cmdInput.addEventListener('input', () => {
      cmdInput.style.height = 'auto';
      cmdInput.style.height = Math.min(120, cmdInput.scrollHeight) + 'px';
    });
    cmdInput.focus();

    // 拖拽
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('.close')) return;
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: panel.offsetLeft,
        origTop: panel.offsetTop,
      };
      panel._manualPos = true;
      panel.style.right = 'auto';
      panel.style.left = dragState.origLeft + 'px';
      e.preventDefault();
    });
  }

  /* 网页输入框自动补全已移除；AI 输入仅保留在扩展对话面板内。 */
  /*
  function isEditableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url', 'tel', ''].includes(t);
    }
    return !!el.isContentEditable;
  }

  function isCodeContext(el) {
    if (!el) return false;
    if (el.closest && el.closest('pre, code, .ace_editor, .CodeMirror, .monaco-editor, .cm-editor, [class*=code], [class*=Code], [class*=editor], [class*=Editor], [aria-label*=代码], [aria-label*=code], [aria-label*=Code], [aria-label*=editor], [aria-label*=Editor]')) return true;
    if (el.tagName === 'TEXTAREA' && el.spellcheck === false) return true;
    try {
      const ff = (getComputedStyle(el).fontFamily || '').toLowerCase();
      if (/mono|menlo|consolas|monospace|courier/i.test(ff)) return true;
    } catch (e) {}
    return false;
  }

  function textBeforeCaret(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return el.value.slice(0, el.selectionStart);
    }
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return '';
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString();
  }

  function textAfterCaret(el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      return el.value.slice(el.selectionEnd);
    }
    return '';
  }

  function caretPixelPosition(el) {
    try {
      const cs = getComputedStyle(el);
      const mirror = document.createElement('div');
      const props = [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
        'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'tabSize',
        'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
        'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
      ];
      for (const p of props) mirror.style[p] = cs[p];
      mirror.style.position = 'fixed';
      mirror.style.top = '0';
      mirror.style.left = '0';
      mirror.style.visibility = 'hidden';
      mirror.style.width = el.clientWidth + 'px';
      mirror.style.height = el.clientHeight + 'px';
      mirror.style.overflow = 'hidden';
      const noWrap =
        (el.tagName === 'TEXTAREA' && el.getAttribute('wrap') === 'off') ||
        cs.whiteSpace === 'pre' ||
        cs.whiteSpace === 'nowrap';
      mirror.style.whiteSpace = noWrap ? 'pre' : 'pre-wrap';
      mirror.style.overflowWrap = noWrap ? 'normal' : 'break-word';
      mirror.style.wordBreak = noWrap ? 'normal' : 'break-word';

      const before = el.value.slice(0, el.selectionStart);
      mirror.textContent = before;
      const marker = document.createElement('span');
      marker.textContent = '\u200b';
      marker.style.position = 'relative';
      mirror.appendChild(marker);
      document.body.appendChild(mirror);
      mirror.scrollTop = el.scrollTop;
      mirror.scrollLeft = el.scrollLeft;

      const mRect = marker.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const left = mRect.left - eRect.left;
      const top = mRect.top - eRect.top;
      const lineHeight = parseFloat(cs.lineHeight) || 20;
      const fontSize = parseFloat(cs.fontSize) || 14;

      document.body.removeChild(mirror);
      return { left, top, lineHeight, fontSize, width: eRect.width, fontFamily: cs.fontFamily };
    } catch (e) {
      return null;
    }
  }

  function removeGhostEl() {
    if (ac.ghostEl) {
      ac.ghostEl.remove();
      ac.ghostEl = null;
    }
  }

  function hideGhost() {
    removeGhostEl();
    ac.el = null;
    ac.text = '';
    ac.busy = false;
    clearTimeout(ac.timer);
    if (ac.port) {
      try {
        ac.port.disconnect();
      } catch (e) {}
      ac.port = null;
    }
  }

  function showGhost(el, text) {
    const pos = caretPixelPosition(el);
    if (!pos) return;
    const rect = el.getBoundingClientRect();
    removeGhostEl();
    const ghost = document.createElement('div');
    ghost.className = 'kb-ghost';
    ghost.style.left = Math.round(rect.left + pos.left) + 'px';
    ghost.style.top = Math.round(rect.top + pos.top) + 'px';
    ghost.style.fontSize = pos.fontSize + 'px';
    ghost.style.lineHeight = pos.lineHeight + 'px';
    ghost.style.fontFamily = pos.fontFamily;
    ghost.style.maxWidth = Math.max(120, pos.width - pos.left) + 'px';
    ghost.textContent = text;
    shadow.appendChild(ghost);
    ac.el = el;
    ac.ghostEl = ghost;
  }

  function showGhostEditable(el, text) {
    const sel = window.getSelection();
    if (sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    removeGhostEl();
    const span = document.createElement('span');
    span.__kbInline = true;
    span.style.color = '#8b949e';
    span.style.opacity = '0.9';
    span.style.pointerEvents = 'none';
    span.textContent = text;
    range.collapse(false);
    range.insertNode(span);
    const newRange = document.createRange();
    newRange.setStartBefore(span);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    ac.el = el;
    ac.ghostEl = span;
  }

  function updateGhost(text) {
    if (ac.ghostEl) ac.ghostEl.textContent = text;
  }

  function acceptGhost() {
    const el = ac.el;
    const text = ac.text;
    if (!el || !text || !el.isConnected) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      el.selectionStart = el.selectionEnd = start + text.length;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable && ac.ghostEl && ac.ghostEl.__kbInline) {
      const span = ac.ghostEl;
      const parent = span.parentNode;
      const txt = document.createTextNode(span.textContent);
      parent.insertBefore(txt, span);
      parent.removeChild(span);
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStartAfter(txt);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      const ev = new Event('input', { bubbles: true });
      el.dispatchEvent(ev);
    }
    hideGhost();
  }

  function requestCompletion(el) {
    if (ac.busy || !ac.enabled) return;
    const before = textBeforeCaret(el);
    if (!before || before.trim().length < 2) return;
    ac.busy = true;
    ac.el = el;
    ac.text = '';
    const p = chrome.runtime.connect({ name: 'ai-stream' });
    ac.port = p;
    p.onMessage.addListener((resp) => {
      if (resp.type === 'chunk') {
        ac.text += resp.text;
        if (!ac.ghostEl) {
          if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') showGhost(el, ac.text);
          else showGhostEditable(el, ac.text);
        } else {
          updateGhost(ac.text);
        }
      } else if (resp.type === 'end') {
        ac.busy = false;
        if (ac.port) {
          try {
            ac.port.disconnect();
          } catch (e) {}
          ac.port = null;
        }
      } else if (resp.type === 'error') {
        hideGhost();
      }
    });
    p.onDisconnect.addListener(() => {
      if (ac.port === p) ac.port = null;
      ac.busy = false;
    });
    p.postMessage({
      action: 'complete',
      text: before.slice(-2000),
      after: textAfterCaret(el).slice(0, 500),
      language: isCodeContext(el) ? '代码' : '文本/文档',
    });
  }

  function scheduleCompletion(el) {
    clearTimeout(ac.timer);
    ac.timer = setTimeout(() => {
      if (el !== document.activeElement) return;
      requestCompletion(el);
    }, 600);
  }

  */
  // ---- 事件绑定 ----
  document.addEventListener('mousedown', (e) => {
    if (host && e.composedPath().includes(host)) return;
    removeBubble();
  });

  document.addEventListener('scroll', () => removeBubble(), true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      removeBubble();
      if (panel) {
        removePanel();
        return;
      }
    }
  }, true);

  document.addEventListener('mousemove', (e) => {
    // 高亮覆盖层不接管鼠标事件，改为根据 Range 判断指针是否进入/离开证据文本。
    // 只有用户实际进入过高亮内容后才在离开时清除，避免点击引用后立刻消失。
    if (citeHighlightRange) {
      const inCitation = isPointerInCitationRange(e);
      if (inCitation) citeHighlightEntered = true;
      else if (citeHighlightEntered) clearCiteHighlight();
    }
    if (dragState && panel) {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      panel.style.left = dragState.origLeft + dx + 'px';
      panel.style.top = dragState.origTop + dy + 'px';
    } else if (resizeState && panel) {
      const dw = e.clientX - resizeState.startX;
      const dh = e.clientY - resizeState.startY;
      const w = Math.max(280, Math.min(window.innerWidth - 24, resizeState.origWidth + dw));
      const h = Math.max(120, Math.min(window.innerHeight - 24, resizeState.origHeight + dh));
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
    }
  });
  document.addEventListener('mouseup', () => {
    dragState = null;
    resizeState = null;
  });

  // 响应后台的即时页面正文读取请求（Agent 工具 read_current_page）
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'kbGetPageText') {
      sendResponse({ text: extractPageText() });
      return true;
    }
    return false;
  });

  // ---- 初始化 ----
  let pageContextEnabled = true;
  getAISettings().then((s) => {
    pageContextEnabled = s.pageContext !== false;
  });

  ensureHost();

  document.addEventListener('mouseup', (e) => {
    if (host && e.composedPath().includes(host)) return;
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (text.length < 2) {
      removeBubble();
      return;
    }
    lastText = text;
    clearCiteHighlight();
    pageText = pageContextEnabled ? extractPageText() : '';
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (panel) {
      refreshPanelForSelection();
      return;
    }
    ensureHost();
    showBubble(rect.left + rect.width / 2, rect.top + window.scrollY);
  });

  // 选中新内容时，刷新已打开的对话框
  function refreshPanelForSelection() {
    closePort();
    lastResponse = '';
    if (panelTextEl) {
      panelTextEl.textContent = lastText.length > 200 ? lastText.slice(0, 200) + '…' : lastText;
      panelTextEl.title = lastText;
    }
    renderConversation();
  }
})();
