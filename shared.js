const STORAGE_KEY = 'knowledgeBase';
const LEGACY_STORAGE_KEY = 'wrongBook';
const DATA_VERSION_KEY = 'knowledgeBaseDataVersion';
const CURRENT_DATA_VERSION = 2;

// 状态常量枚举，避免魔法数字
const STATUS = {
  GENERAL: 1, // 一般
  IMPORTANT: 2, // 重点
  FREQUENT: 3, // 高频
};

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
  [STATUS.GENERAL]: { name: '一般', color: '#f5b860' },
  [STATUS.IMPORTANT]: { name: '重点', color: '#f39c12' },
  [STATUS.FREQUENT]: { name: '高频', color: '#e74c3c' },
};

/**
 * 防抖函数
 * @param {Function} fn - 要执行的函数
 * @param {number} delay - 延迟毫秒数
 * @returns {Function} 防抖后的函数
 */
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 安全日志记录（避免空 catch 块）
 * @param {string} context - 上下文描述
 * @param {Error|*} error - 错误对象
 */
function logError(context, error) {
  console.warn(`[BookmarkSorter] ${context}:`, error);
}

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

/**
 * 通用 toast 提示（供 popup / manager 复用）
 * @param {string} msg - 提示文本
 * @param {Object} [opts] - 可选配置
 * @param {Function} [opts.undoFn] - 撤销回调，提供时显示撤销按钮
 * @param {number} [opts.duration=2000] - 显示时长（毫秒）
 */
let _toastTimer = null;
function showToast(msg, opts) {
  const o = opts || {};
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  if (o.undoFn) {
    const btn = document.createElement('button');
    btn.textContent = '撤销';
    btn.addEventListener('click', () => {
      o.undoFn();
      el.classList.remove('show');
    });
    el.textContent = msg + ' ';
    el.appendChild(btn);
  }
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), o.duration || 2000);
}

const AI_SETTINGS_KEY = 'aiSettings';

const AI_SETTINGS_DEFAULTS = {
  apiKey: '',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
  ragEnabled: true,
  targetLang: '中文',
  autocomplete: true,
  pageContext: true,
  mcpServers: [],
};

async function getAISettings() {
  const d = await chrome.storage.local.get(AI_SETTINGS_KEY);
  return Object.assign({}, AI_SETTINGS_DEFAULTS, d[AI_SETTINGS_KEY] || {});
}

function tokenizeQuery(query) {
  const raw = String(query || '').toLowerCase();
  const segments = raw
    .split(/[\s,，。;；:：!！?？、/\\()[\]{}<>"'`~#@$%^&*+=|]+/)
    .filter((s) => s.length);
  const tokens = [];
  for (const seg of segments) {
    if (seg.length <= 4) {
      tokens.push(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i++) {
        tokens.push(seg.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

function isKbOverviewQuery(q) {
  const s = String(q || '').toLowerCase();
  return /知识库/.test(s) && /有什么|有哪些|内容|都有|全部|列出|list|看看|查看|里面|总结|汇总|概览/.test(s);
}

function buildKbOverview(book, limit) {
  const items = Object.values(book).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const shown = items.slice(0, limit || 30);
  const total = items.length;
  const lines = shown.map((it, i) => {
    const parts = [`[${i + 1}] 标题：${it.title || '未命名'}`];
    parts.push(`类型：${typeInfo(it.type).name}`);
    if (it.status) parts.push(`星级：${(STAR_LEVELS[it.status] || {}).name || it.status}`);
    if (Array.isArray(it.tags) && it.tags.length) parts.push(`标签：${it.tags.join('、')}`);
    if (it.note) parts.push(`内容：${String(it.note).slice(0, 120)}`);
    return parts.join('｜');
  });
  return (
    '用户个人知识库共 ' +
    total +
    ' 条记录' +
    (total > shown.length ? '（以下仅列出最近 ' + shown.length + ' 条，其余未列出）' : '') +
    '：\n' +
    lines.join('\n')
  );
}

/**
 * 构建 RAG 上下文，返回匹配的条目数组
 * 采用字段加权评分：标题权重最高，标签次之，备注最低，提升检索相关性
 * @param {Object} book - 知识库数据
 * @param {string} query - 查询文本
 * @param {number} limit - 最大返回数量
 * @returns {Array} 匹配的条目数组
 */
function buildRagContext(book, query, limit) {
  const terms = tokenizeQuery(query);
  if (!terms.length) return [];

  // 字段权重：标题最重要，标签次之，备注与类型较低
  const WEIGHTS = { title: 3, tags: 2, note: 1, type: 0.5, platform: 0.5 };

  const scored = Object.values(book).map((it) => {
    const titleLow = (it.title || '').toLowerCase();
    const noteLow = (it.note || '').toLowerCase();
    const tagsLow = (it.tags || []).join(' ').toLowerCase();
    const typeLow = (it.type || '').toLowerCase();
    const platformLow = (it.platformName || '').toLowerCase();

    let score = 0;
    const matched = new Set();
    for (const t of terms) {
      if (titleLow.includes(t)) {
        score += WEIGHTS.title;
        matched.add(t);
      }
      if (tagsLow.includes(t)) {
        score += WEIGHTS.tags;
        matched.add(t);
      }
      if (noteLow.includes(t)) {
        score += WEIGHTS.note;
        matched.add(t);
      }
      if (typeLow.includes(t)) score += WEIGHTS.type;
      if (platformLow.includes(t)) score += WEIGHTS.platform;
    }
    // 覆盖度奖励：命中的不同查询词越多，相关性越高
    if (matched.size > 1) score += matched.size * 0.5;
    return { it, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit || 5)
    .map((x) => x.it);
}

/**
 * 构建引用来源元数据，用于前端渲染引用卡片
 * @param {Array} relevantItems - RAG 检索到的条目
 * @param {boolean} isOverview - 是否为知识库概览查询
 * @returns {Array|null} 引用元数据数组 [{index, id, title, type, url}]
 */
function buildCitations(relevantItems, isOverview) {
  if (!relevantItems || !relevantItems.length) return null;
  return relevantItems.map((it, i) => ({
    index: i + 1,
    id: it.id,
    title: it.title || '未命名',
    type: it.type || 'wrong',
    url: it.url || '',
    isOverview: !!isOverview,
  }));
}

function buildAiMessages(action, payload, settings, book) {
  const text = payload.text || '';

  if (action === 'translate') {
    const t = payload.targetLang || settings.targetLang || '中文';
    return [
      { role: 'system', content: '你是一名专业翻译。只输出译文，不要任何解释或额外内容。' },
      { role: 'user', content: '请将以下内容翻译成' + t + '：\n\n' + text },
    ];
  }
  if (action === 'explain') {
    return [
      { role: 'system', content: '你是一名耐心的讲解者，用通俗易懂的中文解释概念，可用 Markdown 排版。' },
      { role: 'user', content: '请解释以下内容：\n\n' + text },
    ];
  }
  if (action === 'summarize') {
    return [
      { role: 'system', content: '你是总结助手，输出简洁的中文要点总结，用 Markdown 列表排版。' },
      { role: 'user', content: '请总结以下内容的要点：\n\n' + text },
    ];
  }
  if (action === 'ask') {
    const question = payload.question || text || '';
    let ctx = '';
    let citations = null;
    if (settings.ragEnabled) {
      if (isKbOverviewQuery(question || text)) {
        ctx = buildKbOverview(book, 30);
        citations = buildCitations(Object.values(book).slice(0, 30), true);
      } else {
        const relevant = buildRagContext(book, question || text, 5);
        if (relevant.length) {
          citations = buildCitations(relevant, false);
          ctx =
            '以下是从用户个人知识库中检索到的相关条目，请优先参考它们回答：\n' +
            relevant
              .map((it, i) => {
                const parts = [`[${i + 1}] 标题：${it.title}`, `类型：${typeInfo(it.type).name}`];
                if (it.note) parts.push('内容/备注：' + it.note);
                if (it.url) parts.push('链接：' + it.url);
                return parts.join('\n');
              })
              .join('\n\n');
        }
      }
    }
    const messages = [
      {
        role: 'system',
        content:
          '你是用户的个人知识库助手。请用中文回答，可用 Markdown 排版。若提供了知识库上下文，请基于它回答，并在引用具体条目时使用 [n] 格式标注来源编号（n 为条目编号）；若无相关知识，请明确说明并给出通用回答。',
      },
      {
        role: 'user',
        content:
          '问题：' +
          question +
          (text ? '\n\n选中的文本：\n' + text : '') +
          (ctx ? '\n\n知识库上下文：\n' + ctx : ''),
      },
    ];
    // 附加引用元数据到 messages 对象（非标准字段，供调用方使用）
    messages._citations = citations;
    return messages;
  }
  if (action === 'command') {
    const instruction = payload.question || payload.command || '';
    const page = payload.page || '';
    const history = Array.isArray(payload.history) ? payload.history.slice(-10) : [];
    let ctx = '';
    let citations = null;
    if (settings.ragEnabled) {
      if (isKbOverviewQuery(instruction || text)) {
        ctx = buildKbOverview(book, 30);
        citations = buildCitations(Object.values(book).slice(0, 30), true);
      } else {
        const relevant = buildRagContext(book, instruction || text, 5);
        if (relevant.length) {
          citations = buildCitations(relevant, false);
          ctx =
            '以下是从用户个人知识库中检索到的相关条目，可参考（引用时请使用 [n] 格式标注来源编号）：\n' +
            relevant
              .map((it, i) => `[${i + 1}] 标题：${it.title}｜类型：${typeInfo(it.type).name}${it.note ? '｜内容：' + it.note : ''}`)
              .join('\n');
        }
      }
    }
    const hasText = !!text;
    const userParts = [];
    if (hasText) userParts.push('选中的文本：\n' + text);
    if (page) userParts.push('当前页面的完整内容（作为背景上下文，回答时请结合整页内容，而不只限于选中文本）：\n' + page);
    if (ctx) userParts.push('知识库上下文（供参考，可选用）：\n' + ctx);
    if (instruction) userParts.push('用户指令：\n' + instruction);
    if (!hasText && !instruction) userParts.push('（无输入）');
    const messages = [
      {
        role: 'system',
        content:
          '你是一个强大的 AI 助手，能执行用户的各种指令：翻译、改写、解释、总结、生成代码、补全内容、润色文档等。回答时应结合用户提供的整个页面内容理解上下文，而不只局限于选中的文字。请严格按指令执行，输出清晰的结果。若指令涉及代码，请直接给出完整代码；若涉及改写/翻译，直接给出结果。可使用 Markdown 排版。',
      },
    ];
    for (const h of history) {
      if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') {
        messages.push({ role: h.role, content: h.content.slice(0, 3000) });
      }
    }
    messages.push({ role: 'user', content: userParts.join('\n\n') });
    // 附加引用元数据到 messages 对象（非标准字段，供调用方使用）
    messages._citations = citations;
    return messages;
  }
  if (action === 'complete') {
    const before = payload.text || payload.before || '';
    const after = payload.after || '';
    const language = payload.language || '代码/文本';
    return [
      {
        role: 'system',
        content:
          '你是代码与文档补全助手。只输出光标位置的续写内容，不要重复已有的文本，不要解释，不要输出完整前后文，只给出紧跟光标之后的补全片段（与上下文衔接自然）。',
      },
      {
        role: 'user',
        content:
          '当前语言/场景：' +
          language +
          '\n光标之前的文本：\n' +
          before +
          (after ? '\n\n光标之后的文本（参考）：\n' + after : '') +
          '\n\n请直接输出光标之后的补全内容：',
      },
    ];
  }
  return null;
}
