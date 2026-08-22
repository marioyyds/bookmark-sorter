// 页面内引用定位与高亮：字符级匹配 + 绝对定位浮层（不改动页面 DOM）
import { logError } from '../shared/utils.js';

export const PAGE_TEXT_EXCLUDE =
  'script,style,noscript,iframe,svg,canvas,nav,header,footer,aside,form,button,input,select,textarea,[contenteditable],.ad,.ads,.advertisement,.banner,[class*=cookie],[id*=cookie],[class*=popup],[class*=modal],#__kb-ai-host';

let citeHighlights = []; // 页面内引用高亮的浮层元素数组（绝对定位覆盖，不改动页面 DOM）
let citeHighlightRange = null;
let citeHighlightEntered = false;

export function normalizeCitationText(value) {
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

export function clearCiteHighlight() {
  citeHighlights.forEach((el) => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  citeHighlights = [];
  citeHighlightRange = null;
  citeHighlightEntered = false;
}

export function isPointerInCitationRange(event) {
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
export function buildPageCharMap() {
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
export function findRangeBySubstr(map, snippet) {
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

// 生成单个绝对定位浮层，覆盖指定矩形（outline 为描边模式，否则为底色高亮）
export function makeOverlay(rect, color, outline) {
  const sx = window.scrollX || 0;
  const sy = window.scrollY || 0;
  const d = document.createElement('div');
  const fill = outline ? '' : 'background-color:' + normalizeFillColor(color) + ';';
  d.style.cssText =
    'position:absolute;left:' + (rect.left + sx) + 'px;top:' + (rect.top + sy) + 'px;' +
    'width:' + rect.width + 'px;height:' + rect.height + 'px;' +
    (outline
      ? 'border:2px solid ' + color + ';background:transparent;'
      : fill) +
    'border-radius:2px;pointer-events:none;z-index:2147483646;';
  document.body.appendChild(d);
  return d;
}

// 无论模型传的是实色还是高透明度颜色，都统一转成低透明度 rgba，
// 避免不透明的高亮把正文文字盖住。
function normalizeFillColor(color) {
  const fallback = overlayColor();
  const cap = 0.32;
  const floor = 0.12;
  let c = String(color || '').trim();
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + Math.min(cap, Math.max(floor, a)) + ')';
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(',').map((s) => s.trim());
    if (parts.length >= 3) {
      let a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
      if (!Number.isFinite(a)) a = 1;
      return 'rgba(' + parts[0] + ',' + parts[1] + ',' + parts[2] + ',' + Math.min(cap, Math.max(floor, a)) + ')';
    }
  }
  return fallback;
}

export function overlayColor() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'rgba(255,196,0,.20)'
    : 'rgba(255,196,0,.26)';
}

// 用绝对定位的浮层覆盖匹配文本，不改动页面 DOM（无空行、无列表编号/代码结构破坏）
export function overlayRange(range, color) {
  const overlays = [];
  const c = color || overlayColor();
  let rects;
  try {
    rects = Array.prototype.slice.call(range.getClientRects());
  } catch (e) {
    rects = [];
  }
  for (const r of rects) {
    if (r.width <= 0 || r.height <= 0) continue;
    overlays.push(makeOverlay(r, c, false));
  }
  return overlays;
}

// 在页面中查找引用片段并高亮精确匹配的文本，滚动到该位置
export function findAndHighlightCitation(snippet) {
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
