// 知识库存储：chrome.storage.local 的 CRUD 与旧版数据迁移
import { STATUS, STORAGE_KEY, LEGACY_STORAGE_KEY, DATA_VERSION_KEY, CURRENT_DATA_VERSION, OLD_STATUS_MIGRATION } from './constants.js';
import { cleanTitle } from './utils.js';

async function getBook() {
  let d = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY, DATA_VERSION_KEY]);
  let book = d[STORAGE_KEY];
  const dataVersion = d[DATA_VERSION_KEY] || 0;

  // 如果数据版本已是最新，直接返回（跳过迁移检查，提升性能）
  if (book && dataVersion >= CURRENT_DATA_VERSION) {
    return book;
  }

  // 首次迁移：从旧版存储格式迁移
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
      await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
    }
  }

  // 数据结构规范化
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
      it.status = OLD_STATUS_MIGRATION[s] || STATUS.IMPORTANT;
      changed = true;
    } else if (s !== STATUS.GENERAL && s !== STATUS.IMPORTANT && s !== STATUS.FREQUENT) {
      it.status = STATUS.IMPORTANT;
      changed = true;
    }
  }

  // 保存数据并标记版本
  await setBook(book);
  await chrome.storage.local.set({ [DATA_VERSION_KEY]: CURRENT_DATA_VERSION });
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

export { getBook, setBook, upsertItem, updateStatus, deleteItem };
