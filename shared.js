const STORAGE_KEY = 'knowledgeBase';
const LEGACY_STORAGE_KEY = 'wrongBook';

const PLATFORMS = [
  { id: 'leetcode', name: 'LeetCode', match: /leetcode\.cn|leetcode\.com/i },
  { id: 'nowcoder', name: '牛客网', match: /nowcoder\.com/i },
  { id: 'luogu', name: '洛谷', match: /luogu\.com\.cn|luogu\.org/i },
  { id: 'acwing', name: 'AcWing', match: /acwing\.com/i },
  { id: 'codeforces', name: 'Codeforces', match: /codeforces\.com/i },
  { id: 'atcoder', name: 'AtCoder', match: /atcoder\.jp/i },
];

const ITEM_TYPES = [
  { id: 'wrong', name: '算法错题', color: '#4a90d9' },
  { id: 'article', name: '技术文章', color: '#27ae60' },
  { id: 'ai', name: 'AI·Prompt', color: '#9b59b6' },
  { id: 'note', name: '笔记想法', color: '#e67e22' },
];

const STAR_LEVELS = {
  1: { name: '一般', color: '#f5b860' },
  2: { name: '重点', color: '#f39c12' },
  3: { name: '高频', color: '#e74c3c' },
};

const OLD_STATUS_MIGRATION = {
  'to-review': 2,
  'redo': 1,
  'mastered': 3,
};

function typeInfo(id) {
  return ITEM_TYPES.find((t) => t.id === id) || ITEM_TYPES[0];
}

function typeColor(id) {
  return typeInfo(id).color;
}

function starColor(n) {
  return (STAR_LEVELS[Number(n)] || STAR_LEVELS[2]).color;
}

function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.href;
  } catch (e) {
    return u;
  }
}

function detectPlatform(u) {
  for (const p of PLATFORMS) {
    if (p.match.test(u)) return { id: p.id, name: p.name };
  }
  return { id: 'other', name: '其他平台' };
}

function detectType(url) {
  if (url && detectPlatform(url).id !== 'other') return 'wrong';
  return 'article';
}

function isWebUrl(u) {
  return /^https?:/i.test(u);
}

function cleanTitle(title) {
  let t = (title || '').trim();
  t = t
    .replace(
      /[|\-–—]\s*(力扣（LeetCode）|力扣|LeetCode|牛客网|牛客|nowcoder|洛谷|Luogu|AcWing|Codeforces|AtCoder).*$/i,
      ''
    )
    .trim();
  return t;
}

function parseTags(str) {
  return String(str || '')
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

async function getBook() {
  let d = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  let book = d[STORAGE_KEY];

  if (!book) {
    const legacy = d[LEGACY_STORAGE_KEY] || {};
    book = {};
    for (const url in legacy) {
      const it = legacy[url];
      it.id = url;
      it.type = 'wrong';
      it.tags = [];
      book[url] = it;
    }
    if (Object.keys(book).length) {
      await setBook(book);
      await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
    }
  }

  let changed = false;
  for (const k in book) {
    const it = book[k];
    if (!it.type) {
      it.type = 'wrong';
      changed = true;
    }
    if (!Array.isArray(it.tags)) {
      it.tags = [];
      changed = true;
    }
    if (!it.id) {
      it.id = k;
      changed = true;
    }
    const s = it.status;
    if (typeof s === 'string') {
      it.status = OLD_STATUS_MIGRATION[s] || 2;
      changed = true;
    } else if (s !== 1 && s !== 2 && s !== 3) {
      it.status = 2;
      changed = true;
    }
  }
  if (changed) await setBook(book);
  return book;
}

async function setBook(book) {
  await chrome.storage.local.set({ [STORAGE_KEY]: book });
}

async function upsertItem({ id, type, title, url, platformId, platformName, status, note, tags }) {
  const book = await getBook();
  const prev = book[id] || {};
  book[id] = {
    id,
    type,
    title: cleanTitle(title) || prev.title || url || '未命名',
    url: url || '',
    platform: platformId || prev.platform || '',
    platformName: platformName || prev.platformName || '',
    status,
    note: typeof note === 'string' ? note.trim() : prev.note || '',
    tags: Array.isArray(tags) ? tags : prev.tags || [],
    createdAt: prev.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await setBook(book);
  return book[id];
}

async function updateStatus(id, status) {
  const book = await getBook();
  if (book[id]) {
    book[id].status = status;
    book[id].updatedAt = Date.now();
    await setBook(book);
  }
}

async function deleteItem(id) {
  const book = await getBook();
  delete book[id];
  await setBook(book);
}

function sortItems(list, sortBy) {
  const arr = list.slice();
  switch (sortBy) {
    case 'created':
      arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      break;
    case 'star-desc':
      arr.sort(
        (a, b) =>
          (b.status || 0) - (a.status || 0) ||
          (b.updatedAt || 0) - (a.updatedAt || 0)
      );
      break;
    case 'star-asc':
      arr.sort(
        (a, b) =>
          (a.status || 0) - (b.status || 0) ||
          (b.updatedAt || 0) - (a.updatedAt || 0)
      );
      break;
    default:
      arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  return arr;
}

function starBarHtml(n, interactive) {
  const level = Math.max(1, Math.min(3, Number(n) || 1));
  let h = `<span class="star-bar${interactive ? ' interactive' : ''}">`;
  for (let i = 1; i <= 3; i++) {
    h += `<span class="star-cell${i <= level ? ' on' : ''}" style="--star-level:${starColor(i)}"${interactive ? ` data-star="${i}"` : ''}>★</span>`;
  }
  h += '</span>';
  return h;
}

function levelNameHtml(n) {
  const st = STAR_LEVELS[Math.max(1, Math.min(3, Number(n) || 1))];
  return `<span class="level-name" style="color:${st.color}">${st.name}</span>`;
}

function typeBadgeHtml(type) {
  const t = typeInfo(type);
  return `<span class="type-badge" style="color:${t.color};background:${t.color}1A;border:1px solid ${t.color}40">${t.name}</span>`;
}

function tagsHtml(tags) {
  if (!Array.isArray(tags) || !tags.length) return '';
  return `<span class="tag-list">${tags
    .map((t) => `<span class="tag-chip">${esc(t)}</span>`)
    .join('')}</span>`;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60 * 60 * 1000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟前';
  if (diff < 24 * 60 * 60 * 1000) return Math.round(diff / 3600000) + ' 小时前';
  if (diff < 7 * 24 * 60 * 60 * 1000) return Math.round(diff / 86400000) + ' 天前';
  return d.toLocaleDateString('zh-CN');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function platformColor(id) {
  return id === 'other' ? '#95a5a6' : '#4a90d9';
}
