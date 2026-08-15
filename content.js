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
  const CONV_KEY = 'kbConversation';

  // 提取页面正文，作为指令的上下文
  function extractPageText() {
    try {
      const doc = document.body;
      if (!doc) return '';
      const clone = doc.cloneNode(true);
      clone
        .querySelectorAll(
          'script, style, noscript, iframe, svg, canvas, nav, header, footer, aside, form, button, input, select, textarea, [contenteditable], .ad, .ads, .advertisement, .banner, [class*=cookie], [id*=cookie], [class*=popup], [class*=modal]'
        )
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
    .p-head .logo { width: 18px; height: 18px; border-radius: 50%; background: #4a90d9; color: #fff; font-size: 10px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
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
    .p-body { padding: 10px 12px; overflow-y: auto; flex: 1 1 auto; font-size: 13px; line-height: 1.7; color: #333; word-break: break-word; min-height: 0; }
    .panel.dark .p-body { color: #e3e5e8; }
    .p-body.loading { color: #999; }
    .panel.dark .p-body.loading { color: #9aa0a8; }
    .p-body.error { color: #e74c3c; }
    .msg { margin-bottom: 8px; max-width: 100%; }
    .msg.user {
      background: #4a90d9; color: #fff; border-radius: 12px 12px 4px 12px;
      padding: 7px 12px; margin-left: 24px; white-space: pre-wrap;
    }
    .msg.ai {
      background: var(--note-bg, #f2f4f7); border-radius: 12px 12px 12px 4px;
      padding: 8px 12px; margin-right: 24px;
    }
    .panel.dark .msg.ai { background: #2a2e34; }
    .msg.ai .typing { color: #999; }
    .panel.dark .msg.ai .typing { color: #9aa0a8; }
    .typing { display: inline-flex; gap: 4px; align-items: center; }
    .typing span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: kb-bounce 1.2s infinite; }
    .typing span:nth-child(2) { animation-delay: .15s; }
    .typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes kb-bounce { 0%,60%,100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-4px); opacity: 1; } }
    .p-body h1, .p-body h2, .p-body h3, .p-body h4 { margin: 10px 0 6px; line-height: 1.3; }
    .p-body h1 { font-size: 16px; } .p-body h2 { font-size: 15px; } .p-body h3 { font-size: 14px; }
    .p-body p { margin: 6px 0; padding: 6px 10px; background: var(--note-bg, #f6f7f9); border-radius: 8px; }
    .panel.dark .p-body p { background: #2a2e34; }
    .msg.ai p:first-child { margin-top: 0; }
    .msg.ai p:last-child { margin-bottom: 0; }
    .p-body ul, .p-body ol { margin: 6px 0; padding-left: 20px; background: var(--note-bg, #f6f7f9); border-radius: 8px; padding-top: 6px; padding-bottom: 6px; }
    .panel.dark .p-body ul, .panel.dark .p-body ol { background: #2a2e34; }
    .p-body li { margin: 2px 0; }
    .p-body code { background: #f0f2f5; border-radius: 4px; padding: 1px 5px; font-size: 12px; font-family: Consolas, monospace; }
    .panel.dark .p-body code { background: #3a3f46; }
    .code-wrap { position: relative; margin: 10px 0; border-radius: 10px; box-shadow: 0 3px 12px rgba(0,0,0,.12); overflow: hidden; }
    .code-wrap pre { background: #f8f9fb; border-radius: 10px; padding: 14px 12px; overflow-x: auto; margin: 0; }
    .panel.dark .code-wrap pre { background: #1f2328; }
    .code-wrap pre code { background: none; padding: 0; }
    .code-copy {
      position: absolute; top: 6px; right: 6px;
      border: 1px solid var(--border, #d5d9e0); background: #fff; color: #888;
      border-radius: 6px; padding: 1px 8px; font-size: 11px; cursor: pointer;
      font-family: inherit; opacity: .7; transition: opacity .15s, color .15s;
      line-height: 1.6;
    }
    .panel.dark .code-copy { background: #3a3f46; border-color: #4a4f57; color: #aaa; }
    .code-copy:hover { opacity: 1; color: #4a90d9; border-color: #4a90d9; }
    .code-copy.copied { color: #27ae60; border-color: #27ae60; }
    .tk-comment { color: #6a737d; font-style: italic; }
    .tk-string { color: #032f62; }
    .tk-number { color: #005cc5; }
    .tk-keyword { color: #d73a49; font-weight: 600; }
    .tk-type { color: #6f42c1; }
    .tk-fn { color: #6f42c1; }
    .panel.dark .tk-comment { color: #8b949e; }
    .panel.dark .tk-string { color: #a5d6ff; }
    .panel.dark .tk-number { color: #79c0ff; }
    .panel.dark .tk-keyword { color: #ff7b72; }
    .panel.dark .tk-type { color: #d2a8ff; }
    .panel.dark .tk-fn { color: #d2a8ff; }
    .p-body blockquote {
      background: var(--note-bg, #f2f4f7); border-left: 3px solid #4a90d9;
      padding: 8px 12px; color: #666; margin: 8px 0; border-radius: 0 8px 8px 0;
    }
    .panel.dark .p-body blockquote { background: #2a2e34; color: #b8bec6; }
    .p-body a { color: #4a90d9; }
    .p-body strong { font-weight: 700; }
    .p-foot { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid #e2e5ea; }
    .panel.dark .p-foot { border-color: #3a3f46; }
    .p-foot button { border: 1px solid #e2e5ea; background: #fff; color: #555; border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; transition: all .15s; }
    .panel.dark .p-foot button { background: #26292e; border-color: #3a3f46; color: #ccc; }
    .p-foot button:hover { border-color: #4a90d9; color: #4a90d9; }
    .p-foot .spacer { flex: 1; }
    .p-foot .copy-btn { margin-left: auto; }
    .cmd-box { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid #e2e5ea; align-items: stretch; flex-shrink: 0; }
    .panel.dark .cmd-box { border-color: #3a3f46; }
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
    .kb-ghost {
      position: fixed; z-index: 2147483646;
      color: #8b949e; opacity: .9; pointer-events: none;
      white-space: pre-wrap; word-break: break-word;
      user-select: none; overflow-wrap: anywhere;
    }
    .fab {
      position: fixed; right: 16px; top: 38%; z-index: 2147483646;
      width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(135deg, #4a90d9, #6aa5e0);
      color: #fff; display: flex; align-items: center; justify-content: center;
      font-size: 15px; font-weight: 700; cursor: pointer;
      box-shadow: 0 4px 16px rgba(74,144,217,.4);
      transition: transform .15s, box-shadow .15s;
      user-select: none;
    }
    .fab:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(74,144,217,.5); }
    .fab.hidden { display: none; }
    .fab.thinking { animation: fab-pulse 1.2s ease-in-out infinite; }
    @keyframes fab-pulse { 0%,100% { box-shadow: 0 4px 16px rgba(74,144,217,.4); } 50% { box-shadow: 0 4px 24px rgba(74,144,217,.75); } }
  `;

  // ---- 自动补全状态 ----
  const ac = {
    el: null,
    ghostEl: null,
    port: null,
    text: '',
    timer: null,
    busy: false,
    enabled: false,
  };

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

    fab = document.createElement('div');
    fab.className = 'fab';
    fab.textContent = 'AI';
    fab.title = 'AI 助手';
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
    bubble.innerHTML = '<span class="dot"></span><span>AI 助手</span>';
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
    const maxH = window.innerHeight - (panel.classList.contains('docked') ? 80 : 24);
    panel.style.height = 'auto';
    panelBody.style.height = 'auto';
    panelBody.style.flex = '';
    panelBody.style.overflowY = 'auto';
    let chromeH = 0;
    for (const child of panel.children) {
      if (child !== panelBody && !child.classList.contains('resize-handle')) chromeH += child.offsetHeight;
    }
    const bodyNatH = panelBody.scrollHeight;
    const bodyH = Math.max(40, Math.min(bodyNatH, maxH - chromeH));
    panelBody.style.flex = 'none';
    panelBody.style.height = bodyH + 'px';
    panelBody.style.overflowY = bodyNatH > bodyH ? 'auto' : 'hidden';
    const totalH = Math.max(120, chromeH + bodyH);
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

  // ---- Markdown 渲染 ----
  function renderMarkdown(md) {
    const lines = md.split('\n');
    let html = '';
    let inCode = false;
    let codeBuf = [];
    let listType = null;

    const escInline = (s) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const inline = (s) => {
      let r = escInline(s);
      r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
      r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      r = r.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
      r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
      return r;
    };

    const flushList = () => {
      if (listType) {
        html += '</' + listType + '>';
        listType = null;
      }
    };

    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (line.trim().startsWith('```')) {
        if (inCode) {
          html += '<div class="code-wrap"><button class="code-copy">复制</button><pre><code>' + highlightCode(codeBuf.join('\n')) + '</code></pre></div>';
          codeBuf = [];
          inCode = false;
        } else {
          flushList();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }
      const mH = line.match(/^(#{1,4})\s+(.*)/);
      if (mH) {
        flushList();
        const lv = mH[1].length;
        html += '<h' + lv + '>' + inline(mH[2]) + '</h' + lv + '>';
        continue;
      }
      const mUl = line.match(/^\s*[-*+]\s+(.*)/);
      if (mUl) {
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
        html += '<blockquote>' + inline(mBq[1]) + '</blockquote>';
        continue;
      }
      flushList();
      if (line.trim() === '') {
        continue;
      }
      html += '<p>' + inline(line) + '</p>';
    }
    flushList();
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
    panelBody.className = 'p-body';
    panelBody.innerHTML = conversation
      .map((m) => {
        if (m.role === 'user') {
          return '<div class="msg user">' + escHtml(m.content) + '</div>';
        }
        return '<div class="msg ai">' + renderMarkdown(m.content || '') + '</div>';
      })
      .join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function openPanel(x, y, docked) {
    removeBubble();
    removePanel();
    hideGhost();
    if (fab) fab.classList.add('hidden');

    panel = document.createElement('div');
    panel.className = 'panel';
    if (docked) panel.classList.add('docked');

    const head = document.createElement('div');
    head.className = 'p-head';
    const logo = document.createElement('span');
    logo.className = 'logo';
    logo.textContent = 'AI';
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = 'AI 助手';
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
      const btn = e.target.closest('.code-copy');
      if (!btn) return;
      const codeEl = btn.parentElement && btn.parentElement.querySelector('code');
      if (!codeEl) return;
      navigator.clipboard.writeText(codeEl.textContent || '').then(() => {
        btn.textContent = '已复制';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = '复制';
          btn.classList.remove('copied');
        }, 1200);
      });
    });
    panel.appendChild(panelBody);

    loadConversation().then(() => {
      renderConversation();
      fitPanelHeight();
      panelBody.scrollTop = panelBody.scrollHeight;
    });

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
    panel.appendChild(cmdWrap);

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
    foot.appendChild(clearBtn);
    foot.appendChild(copyBtn);
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

    function run(instruction) {
      closePort();
      lastResponse = '';
      conversation.push({ role: 'user', content: instruction });
      const userMsg = document.createElement('div');
      userMsg.className = 'msg user';
      userMsg.textContent = instruction;
      const aiMsg = document.createElement('div');
      aiMsg.className = 'msg ai';
      aiMsg.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
      panelBody.appendChild(userMsg);
      panelBody.appendChild(aiMsg);
      fitPanelHeight();
      panelBody.scrollTop = panelBody.scrollHeight;

      let acc = '';
      let started = false;
      port = chrome.runtime.connect({ name: 'ai-stream' });
      port.onMessage.addListener((resp) => {
        if (resp.type === 'chunk') {
          acc += resp.text;
          if (!started) started = true;
          aiMsg.innerHTML = renderMarkdown(acc);
          fitPanelHeight();
          panelBody.scrollTop = panelBody.scrollHeight;
        } else if (resp.type === 'end') {
          if (!started) aiMsg.textContent = '（无返回内容）';
          lastResponse = acc || '';
          conversation.push({ role: 'assistant', content: lastResponse });
          saveConversation();
          fitPanelHeight();
          closePort();
        } else if (resp.type === 'error') {
          aiMsg.textContent = resp.error;
          aiMsg.style.color = '#e74c3c';
          if (resp.needSetup) {
            const go = document.createElement('button');
            go.textContent = '打开设置';
            go.style.cssText =
              'margin-left:8px;border:1px solid #4a90d9;color:#4a90d9;background:none;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px;';
            go.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openOptions' }));
            aiMsg.appendChild(document.createElement('br'));
            aiMsg.appendChild(go);
          }
          closePort();
        }
      });
      port.onDisconnect.addListener(() => {
        closePort();
      });
      port.postMessage({
        action: 'command',
        question: instruction,
        text: lastText,
        page: pageText,
        history: conversation.slice(0, -1),
      });
    }

    function send() {
      const cmd = cmdInput.value.trim();
      if (!cmd) return;
      run(cmd);
      cmdInput.value = '';
      cmdInput.style.height = 'auto';
      cmdInput.style.height = '34px';
      sendBtn.disabled = true;
      setTimeout(() => (sendBtn.disabled = false), 200);
      cmdInput.focus();
    }

    sendBtn.addEventListener('click', send);
    cmdInput.addEventListener('keydown', (e) => {
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

  // ---- 自动补全 ----
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
    return !!(el.closest && el.closest('pre, code, .ace_editor, .CodeMirror, .monaco-editor, .cm-editor, [class*=code], [class*=Code], [class*=editor], [class*=Editor]'));
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
        'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform',
        'whiteSpace', 'wordWrap', 'wordBreak', 'overflowWrap',
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
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordBreak = 'break-word';

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

  // ---- 事件绑定 ----
  document.addEventListener('mousedown', (e) => {
    if (host && e.composedPath().includes(host)) return;
    removeBubble();
  });

  document.addEventListener('scroll', () => {
    removeBubble();
    hideGhost();
  }, true);
  window.addEventListener('resize', hideGhost);

  document.addEventListener('focusin', () => hideGhost(), true);
  document.addEventListener('blur', () => hideGhost(), true);

  document.addEventListener('input', (e) => {
    if (host && e.composedPath().includes(host)) return;
    if (!ac.enabled) return;
    const el = e.target;
    if (!isEditableElement(el)) return;
    if (el !== document.activeElement) return;
    hideGhost();
    scheduleCompletion(el);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideGhost();
      removeBubble();
      if (panel) {
        removePanel();
        return;
      }
    }
    if (ac.ghostEl && ac.el === document.activeElement) {
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        acceptGhost();
        return;
      }
    }
  }, true);

  document.addEventListener('mousemove', (e) => {
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

  // ---- 初始化 ----
  let pageContextEnabled = true;
  getAISettings().then((s) => {
    ac.enabled = !!(s.apiKey && s.autocomplete !== false);
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
