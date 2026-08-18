const $ = (id) => document.getElementById(id);

async function load() {
  const s = await getAISettings();
  $('api-key').value = s.apiKey;
  $('model').value = s.model;
  $('base-url').value = s.baseUrl;
  $('rag-enabled').checked = !!s.ragEnabled;
  $('target-lang').value = s.targetLang;
  $('autocomplete').checked = s.autocomplete !== false;
  $('page-context').checked = s.pageContext !== false;
  renderMcp(s.mcpServers || []);
}

function renderMcp(list) {
  const box = $('mcp-list');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<p class="mcp-empty">尚未配置 MCP 服务器</p>';
    return;
  }
  list.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'mcp-row';
    row.innerHTML =
      '<input class="mcp-id" placeholder="标识(英文)" value="' + esc(s.id || '') + '">' +
      '<input class="mcp-url" placeholder="https://host/mcp" value="' + esc(s.url || '') + '">' +
      '<input class="mcp-token" placeholder="Bearer Token(可选)" value="' + esc((s.headers && s.headers.Authorization || '').replace(/^Bearer\s*/i, '')) + '">' +
      '<button class="mcp-del icon-btn" title="删除">✕</button>';
    row.querySelector('.mcp-del').addEventListener('click', () => {
      list.splice(i, 1);
      renderMcp(list);
    });
    box.appendChild(row);
  });
}

function toast(msg, ok) {
  const st = $('status');
  st.textContent = msg;
  st.className = 'status' + (ok ? ' ok' : '');
  clearTimeout(st._t);
  st._t = setTimeout(() => {
    st.textContent = '';
    st.className = 'status';
  }, 1800);
}

$('save-btn').addEventListener('click', async () => {
  const settings = {
    apiKey: $('api-key').value.trim(),
    model: $('model').value.trim() || AI_SETTINGS_DEFAULTS.model,
    baseUrl: $('base-url').value.trim().replace(/\/+$/, '') || AI_SETTINGS_DEFAULTS.baseUrl,
    ragEnabled: $('rag-enabled').checked,
    targetLang: $('target-lang').value.trim() || AI_SETTINGS_DEFAULTS.targetLang,
    autocomplete: $('autocomplete').checked,
    pageContext: $('page-context').checked,
    mcpServers: collectMcp(),
  };
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: settings });
  toast('✓ 已保存', true);
});

$('toggle-key').addEventListener('click', () => {
  const el = $('api-key');
  el.type = el.type === 'password' ? 'text' : 'password';
  $('toggle-key').textContent = el.type === 'password' ? '👁' : '🙈';
});

function collectMcp() {
  const rows = document.querySelectorAll('#mcp-list .mcp-row');
  const out = [];
  rows.forEach((r) => {
    const id = r.querySelector('.mcp-id').value.trim();
    const url = r.querySelector('.mcp-url').value.trim();
    const token = r.querySelector('.mcp-token').value.trim();
    if (!id || !url) return;
    const srv = { id, url };
    if (token) srv.headers = { Authorization: 'Bearer ' + token };
    out.push(srv);
  });
  return out;
}

$('mcp-add').addEventListener('click', () => {
  const list = collectMcp();
  list.push({ id: '', url: '', headers: {} });
  renderMcp(list);
});

load();
