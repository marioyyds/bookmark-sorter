let bookCache = {};
let currentTab = null;
let currentUrl = null;
let currentTitle = null;
let platform = null;
let selectedType = 'wrong';
let selectedStatus = 2;
let currentFilter = 'all';
let sortBy = 'updated';

const $ = (id) => document.getElementById(id);

let toastTimer = null;

function toast(msg) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

async function loadCache() {
  bookCache = await getBook();
}

async function persist() {
  await setBook(bookCache);
}

function renderTypePicker() {
  const el = document.querySelector('#add-panel .type-group');
  el.innerHTML = ITEM_TYPES.map(
    (t) => `<button class="type-btn${selectedType === t.id ? ' active' : ''}" data-type="${t.id}" style="--t:${t.color}">${t.name}</button>`
  ).join('');
}

function syncStatusHighlight() {
  const barEl = document.querySelector('#add-panel .star-picker');
  if (!barEl) return;
  barEl.innerHTML = starBarHtml(selectedStatus, true);
  const nameEl = document.querySelector('#add-panel .star-picker-name');
  if (nameEl) nameEl.innerHTML = levelNameHtml(selectedStatus);
}

function renderList() {
  const listEl = $('list');
  const emptyEl = $('empty');
  let items = Object.values(bookCache);
  if (currentFilter !== 'all') {
    items = items.filter((i) => (i.type || 'wrong') === currentFilter);
  }
  items = sortItems(items, sortBy);

  emptyEl.classList.toggle('hidden', items.length > 0);
  listEl.innerHTML = items.map(itemHtml).join('');
  $('total-badge').textContent = Object.keys(bookCache).length + ' 条';
}

function itemHtml(it) {
  const type = it.type || 'wrong';
  const urlLink = it.url
    ? `<span class="item-title" title="${esc(it.url)}">${esc(it.title)}</span>`
    : `<span class="item-title no-link">${esc(it.title)}</span>`;
  return `<div class="item" data-id="${esc(it.id)}">
    <div class="item-head">
      ${typeBadgeHtml(type)}
      ${urlLink}
      <button class="icon-btn del" title="删除">✕</button>
    </div>
    ${it.note ? `<div class="item-note">${esc(it.note)}</div>` : ''}
    ${tagsHtml(it.tags)}
    <div class="item-meta">
      ${starBarHtml(it.status, true)}
      ${levelNameHtml(it.status)}
      <span class="time">${fmtTime(it.updatedAt)}</span>
    </div>
  </div>`;
}

async function init() {
  await loadCache();
  renderTypePicker();
  renderList();

  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (t && t.url && isWebUrl(t.url)) {
    currentTab = t;
    currentUrl = normalizeUrl(t.url);
    currentTitle = cleanTitle(t.title) || t.url;
    platform = detectPlatform(t.url);
    selectedType = detectType(t.url);

    $('add-title').textContent = currentTitle;
    const pEl = $('add-platform');
    pEl.textContent = platform.name;
    pEl.style.background = platformColor(platform.id);
    pEl.classList.remove('hidden');

    if (bookCache[currentUrl]) {
      const rec = bookCache[currentUrl];
      $('add-exists').classList.remove('hidden');
      selectedType = rec.type || 'wrong';
      selectedStatus = rec.status;
      $('tags-input').value = (rec.tags || []).join(', ');
      $('note-input').value = rec.note || '';
      $('add-btn').textContent = '更新';
    }
  } else {
    $('add-panel').classList.add('hidden');
  }
  renderTypePicker();
  syncStatusHighlight();
}

$('add-btn').addEventListener('click', async () => {
  if (!currentUrl) return;
  const tags = parseTags($('tags-input').value);
  await upsertItem({
    id: currentUrl,
    type: selectedType,
    title: currentTitle,
    url: currentUrl,
    platformId: platform.id,
    platformName: platform.name,
    status: selectedStatus,
    note: $('note-input').value,
    tags,
  });
  await loadCache();
  $('add-exists').classList.remove('hidden');
  $('add-btn').textContent = '更新';
  renderList();
  toast('已收录到知识库');
});

document.querySelector('#add-panel .type-group').addEventListener('click', (e) => {
  const btn = e.target.closest('.type-btn');
  if (!btn) return;
  selectedType = btn.dataset.type;
  renderTypePicker();
});

document.querySelector('#add-panel .star-picker').addEventListener('click', (e) => {
  const cell = e.target.closest('.star-cell[data-star]');
  if (!cell) return;
  selectedStatus = Number(cell.dataset.star);
  syncStatusHighlight();
});

document.querySelectorAll('.filter-chip').forEach((c) => {
  c.addEventListener('click', () => {
    currentFilter = c.dataset.filter;
    document.querySelectorAll('.filter-chip').forEach((x) => {
      x.classList.toggle('active', x === c);
    });
    renderList();
  });
});

$('sort-select').addEventListener('change', (e) => {
  sortBy = e.target.value;
  renderList();
});

$('list').addEventListener('click', async (e) => {
  const itemEl = e.target.closest('.item');
  if (!itemEl) return;
  const id = itemEl.dataset.id;

  if (e.target.closest('.del')) {
    delete bookCache[id];
    await persist();
    renderList();
    return;
  }

  const starCell = e.target.closest('.star-cell[data-star]');
  if (starCell) {
    const a = Number(starCell.dataset.star);
    if (bookCache[id] && a >= 1 && a <= 3) {
      bookCache[id].status = a;
      bookCache[id].updatedAt = Date.now();
      await persist();
      renderList();
    }
    return;
  }

  if (e.target.closest('.item-title') && bookCache[id] && bookCache[id].url) {
    chrome.tabs.create({ url: bookCache[id].url });
  }
});

$('open-manager').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
});

$('open-settings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
