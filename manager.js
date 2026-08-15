let bookCache = {};
let currentType = 'all';
let currentTag = 'all';
let currentStar = 'all';
let sortBy = 'updated';
let editingNoteId = null;

const $ = (id) => document.getElementById(id);

async function loadCache() {
  bookCache = await getBook();
}

async function persist() {
  await setBook(bookCache);
}

function allTags() {
  const map = {};
  Object.values(bookCache).forEach((it) => {
    (it.tags || []).forEach((t) => {
      if (t) map[t] = (map[t] || 0) + 1;
    });
  });
  return Object.keys(map).sort((a, b) => map[b] - map[a]);
}

function renderTypeTabs() {
  const el = $('type-tabs');
  let h = `<button class="type-tab${currentType === 'all' ? ' active' : ''}" data-type="all">全部</button>`;
  ITEM_TYPES.forEach((t) => {
    const n = Object.values(bookCache).filter((i) => (i.type || 'wrong') === t.id).length;
    h += `<button class="type-tab${currentType === t.id ? ' active' : ''}" data-type="${t.id}" style="--t:${t.color}">${t.name} <span class="cnt">${n}</span></button>`;
  });
  el.innerHTML = h;
}

function renderTagFilter() {
  const tags = allTags();
  const el = $('tag-filter');
  if (!tags.length) {
    el.innerHTML = '';
    return;
  }
  let h = `<button class="tag-filter-chip${currentTag === 'all' ? ' active' : ''}" data-tag="all">全部标签</button>`;
  tags.forEach((t) => {
    h += `<button class="tag-filter-chip${currentTag === t ? ' active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`;
  });
  el.innerHTML = h;
}

function filtered() {
  let items = Object.values(bookCache);
  if (currentType !== 'all') {
    items = items.filter((i) => (i.type || 'wrong') === currentType);
  }
  if (currentTag !== 'all') {
    items = items.filter((i) => (i.tags || []).includes(currentTag));
  }
  if (currentStar !== 'all') {
    items = items.filter((i) => String(i.status) === currentStar);
  }
  const q = $('search').value.trim().toLowerCase();
  if (q) {
    items = items.filter((i) =>
      (i.title + ' ' + (i.note || '') + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(q)
    );
  }
  return sortItems(items, sortBy);
}

function itemHtml(it) {
  const editing = editingNoteId === it.id;
  const titleHtml = editing
    ? `<input id="title-editor" class="note-editor title-editor" value="${esc(it.title)}" placeholder="标题">`
    : it.url
      ? `<span class="item-title" data-open>${esc(it.title)}</span>`
      : `<span class="item-title">${esc(it.title)}</span>`;
  const noteHtml = editing
    ? `<input id="note-editor" class="note-editor" value="${esc(it.note || '')}" placeholder="备注 / 摘要...">`
    : it.note
      ? `<div class="item-note" data-note>${esc(it.note)}</div>`
      : '';
  const tagEditHtml = editing
    ? `<input id="tag-editor" class="note-editor" value="${esc((it.tags || []).join(', '))}" placeholder="标签，逗号分隔">`
    : tagsHtml(it.tags);
  return `<div class="item" data-id="${esc(it.id)}">
    <div class="item-head">
      ${typeBadgeHtml(it.type)}
      ${titleHtml}
      ${editing ? '' : `<span class="time">${fmtTime(it.updatedAt)}</span>`}
    </div>
    <div class="item-meta">
      ${starBarHtml(it.status, true)}
      ${levelNameHtml(it.status)}
      ${it.platformName ? `<span class="pf-name">${esc(it.platformName)}</span>` : ''}
    </div>
    <div class="note-row">${noteHtml}</div>
    <div class="tag-row">${tagEditHtml}</div>
    <div class="item-actions">
      ${editing
        ? `<button class="mini primary" data-act="save">保存</button><button class="mini" data-act="cancel">取消</button>`
        : `<button class="mini" data-act="edit">编辑</button><button class="mini danger" data-act="del">删除</button>`}
    </div>
  </div>`;
}

function render() {
  const items = filtered();
  $('empty').classList.toggle('hidden', items.length > 0);
  $('list').innerHTML = items.map(itemHtml).join('');
  renderTypeTabs();
  renderTagFilter();
  renderStats();
}

function renderStats() {
  const all = Object.values(bookCache);
  $('st-total').textContent = all.length;
  [1, 2, 3].forEach((s) => {
    $('st-' + s).textContent = all.filter((i) => Number(i.status) === s).length;
  });
  document.querySelectorAll('.stars-lbl').forEach((el) => {
    el.innerHTML = starBarHtml(Number(el.dataset.stars), false) + ' ' + (STAR_LEVELS[Number(el.dataset.stars)] || {}).name;
  });
  document.querySelectorAll('.stat-card').forEach((el) => {
    el.classList.toggle('active', el.dataset.s === currentStar);
  });
}

function genId() {
  return 'note-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

async function createNote() {
  const id = genId();
  bookCache[id] = {
    id,
    type: 'note',
    title: '新笔记',
    url: '',
    platform: '',
    platformName: '',
    status: 2,
    note: '',
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await persist();
  editingNoteId = id;
  render();
  const input = $('note-editor');
  if (input) input.focus();
}

$('type-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.type-tab');
  if (!btn) return;
  currentType = btn.dataset.type;
  render();
});

$('tag-filter').addEventListener('click', (e) => {
  const chip = e.target.closest('.tag-filter-chip');
  if (!chip) return;
  currentTag = chip.dataset.tag;
  render();
});

document.querySelectorAll('.stat-card').forEach((el) => {
  el.addEventListener('click', () => {
    currentStar = el.dataset.s;
    render();
  });
});

$('search').addEventListener('input', render);

$('sort-select').addEventListener('change', (e) => {
  sortBy = e.target.value;
  render();
});

$('add-note-btn').addEventListener('click', createNote);

$('list').addEventListener('click', async (e) => {
  const itemEl = e.target.closest('.item');
  if (!itemEl) return;
  const id = itemEl.dataset.id;

  if (e.target.closest('.item-note')) {
    editingNoteId = id;
    render();
    const input = $('note-editor');
    if (input) input.focus();
    return;
  }

  const starCell = e.target.closest('.star-cell[data-star]');
  if (starCell) {
    bookCache[id].status = Number(starCell.dataset.star);
    bookCache[id].updatedAt = Date.now();
    await persist();
    render();
    return;
  }

  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'del') {
      delete bookCache[id];
      if (editingNoteId === id) editingNoteId = null;
      await persist();
      render();
    } else if (a === 'edit') {
      editingNoteId = id;
      render();
      const input = $('title-editor') || $('note-editor');
      if (input) input.focus();
    } else if (a === 'save') {
      const t = $('title-editor');
      const n = $('note-editor');
      const g = $('tag-editor');
      if (t) bookCache[id].title = t.value.trim() || bookCache[id].title;
      if (n) bookCache[id].note = n.value;
      if (g) bookCache[id].tags = parseTags(g.value);
      bookCache[id].updatedAt = Date.now();
      editingNoteId = null;
      await persist();
      render();
    } else if (a === 'cancel') {
      editingNoteId = null;
      render();
    }
    return;
  }

  if (e.target.closest('.item-title') && bookCache[id] && bookCache[id].url) {
    chrome.tabs.create({ url: bookCache[id].url });
  }
});

$('list').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  if (!editingNoteId) return;
  const t = $('title-editor');
  const n = $('note-editor');
  const g = $('tag-editor');
  if (!t && !n && !g) return;
  if (t) bookCache[editingNoteId].title = t.value.trim() || bookCache[editingNoteId].title;
  if (n) bookCache[editingNoteId].note = n.value;
  if (g) bookCache[editingNoteId].tags = parseTags(g.value);
  bookCache[editingNoteId].updatedAt = Date.now();
  editingNoteId = null;
  await persist();
  render();
});

$('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(bookCache, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '知识库备份.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

(async function init() {
  await loadCache();
  render();
})();
