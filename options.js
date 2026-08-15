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
  };
  await chrome.storage.local.set({ [AI_SETTINGS_KEY]: settings });
  toast('✓ 已保存', true);
});

$('toggle-key').addEventListener('click', () => {
  const el = $('api-key');
  el.type = el.type === 'password' ? 'text' : 'password';
  $('toggle-key').textContent = el.type === 'password' ? '👁' : '🙈';
});

load();
