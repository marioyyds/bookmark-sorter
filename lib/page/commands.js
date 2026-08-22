// 页面命令系统：结构化命令控制当前页面 DOM（高亮、滚动、改样式、点击、描边、读取）。
// 通过 chrome.runtime 消息由后台 Agent 工具（page_command）或用户直接调用。
import { normalizeCitationText, PAGE_TEXT_EXCLUDE, buildPageCharMap, findRangeBySubstr, makeOverlay, overlayColor, overlayRange } from './citation.js';

let cmdOverlays = []; // 命令产生的浮层（高亮/描边）
let cmdStyleReverters = []; // set_style 的还原函数
let cmdTimers = []; // outline / set_style 的定时器

function clearCmdOverlays() {
  cmdOverlays.forEach((el) => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  cmdOverlays = [];
}

export function resetPageCommands() {
  clearCmdOverlays();
  cmdStyleReverters.forEach((fn) => {
    try { fn(); } catch (e) {}
  });
  cmdStyleReverters = [];
  cmdTimers.forEach((t) => clearTimeout(t));
  cmdTimers = [];
}

// 按文本查找最具体（最深）的匹配元素，避免返回整个 body/大容器
function findElementsByText(text, limit) {
  const q = normalizeCitationText(text);
  if (!q) return [];
  const cands = document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th,dt,dd,span,a,div,blockquote,figcaption');
  const hits = [];
  for (const el of cands) {
    if (el.closest(PAGE_TEXT_EXCLUDE)) continue;
    if (normalizeCitationText(el.textContent).includes(q)) hits.push(el);
  }
  // 只保留最深层（最具体）的命中：排除「还包含其他命中元素」的容器，避免返回整个 body/大容器
  const deepest = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
  return deepest.slice(0, limit || 5);
}

// 按 selector 或 text 解析目标元素列表
function findElementsFor(params) {
  if (params.selector) {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(params.selector));
    } catch (e) {
      return [];
    }
  }
  if (params.text) return findElementsByText(params.text, 5);
  return [];
}

// 按文本精确定位 Range（复用引用定位的字符级匹配）
function findRangeFor(params) {
  if (!params.text) return null;
  try {
    return findRangeBySubstr(buildPageCharMap(), params.text);
  } catch (e) {
    return null;
  }
}

function scrollRangeIntoView(range) {
  const rect = range.getBoundingClientRect();
  if (rect && rect.height) {
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - window.innerHeight * 0.38), behavior: 'smooth' });
  } else {
    const el = range.startContainer.parentElement;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function cmdHighlight(params) {
  const color = params.color || overlayColor();
  if (params.text) {
    const range = findRangeFor(params);
    if (!range) return { ok: false, error: '未在页面中找到文本：' + params.text };
    cmdOverlays = cmdOverlays.concat(overlayRange(range, color));
    scrollRangeIntoView(range);
    return { ok: true, result: '已高亮文本' };
  }
  if (params.selector) {
    const els = findElementsFor(params);
    if (!els.length) return { ok: false, error: '未找到选择器匹配元素：' + params.selector };
    els.forEach((el) => {
      const d = makeOverlay(el.getBoundingClientRect(), color, false);
      if (d) cmdOverlays.push(d);
    });
    els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { ok: true, result: '已高亮 ' + els.length + ' 个元素' };
  }
  return { ok: false, error: 'highlight 需要 text 或 selector 参数' };
}

function cmdScrollTo(params) {
  const behavior = params.behavior === 'auto' ? 'auto' : 'smooth';
  const block = params.block || 'start';
  if (params.text || params.selector) {
    if (params.text) {
      const range = findRangeFor(params);
      if (range) {
        scrollRangeIntoView(range);
        return { ok: true, result: '已滚动到目标文本' };
      }
    }
    const els = findElementsFor(params);
    if (!els.length) return { ok: false, error: '未找到目标元素' };
    els[0].scrollIntoView({ behavior, block });
    return { ok: true, result: '已滚动到目标元素' };
  }
  if (typeof params.top === 'number' || typeof params.left === 'number') {
    window.scrollTo({ top: Number(params.top) || 0, left: Number(params.left) || 0, behavior });
    return { ok: true, result: '已滚动到指定位置' };
  }
  return { ok: false, error: 'scroll_to 需要 text/selector 或 top/left 参数' };
}

function cmdScrollBy(params) {
  window.scrollBy({
    top: Number(params.y) || 0,
    left: Number(params.x) || 0,
    behavior: params.behavior === 'auto' ? 'auto' : 'smooth',
  });
  return { ok: true, result: '已滚动' };
}

function cmdOutline(params) {
  const color = params.color || '#ff5722';
  const els = findElementsFor(params);
  if (!els.length) return { ok: false, error: '未找到目标元素' };
  const added = [];
  els.forEach((el) => {
    const d = makeOverlay(el.getBoundingClientRect(), color, true);
    if (d) {
      cmdOverlays.push(d);
      added.push(d);
    }
  });
  els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  const dur = Math.max(0, Number(params.duration) || 1500);
  const t = setTimeout(() => {
    added.forEach((d) => {
      if (d.parentNode) d.parentNode.removeChild(d);
      const i = cmdOverlays.indexOf(d);
      if (i >= 0) cmdOverlays.splice(i, 1);
    });
  }, dur);
  cmdTimers.push(t);
  return { ok: true, result: '已描边 ' + els.length + ' 个元素' };
}

function cmdSetStyle(params) {
  const els = findElementsFor(params);
  if (!els.length) return { ok: false, error: '未找到目标元素' };
  const styles = params.styles;
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) {
    return { ok: false, error: 'set_style 需要 styles 对象' };
  }
  const backups = els.map((el) => ({ el, old: el.style.cssText }));
  els.forEach((el) => {
    Object.keys(styles).forEach((k) => {
      try { el.style[k] = styles[k]; } catch (e) {}
    });
  });
  const revert = () => backups.forEach((b) => { b.el.style.cssText = b.old; });
  const dur = Number(params.duration);
  if (dur > 0) {
    cmdTimers.push(setTimeout(revert, dur));
    return { ok: true, result: '已修改 ' + els.length + ' 个元素样式（' + dur + 'ms 后还原）' };
  }
  cmdStyleReverters.push(revert);
  return { ok: true, result: '已修改 ' + els.length + ' 个元素样式（clear_highlights 还原）' };
}

function cmdClick(params) {
  const els = findElementsFor(params);
  if (!els.length) return { ok: false, error: '未找到目标元素' };
  try {
    els[0].click();
  } catch (e) {
    return { ok: false, error: '点击失败：' + e.message };
  }
  return { ok: true, result: '已点击元素 ' + (els[0].tagName || '').toLowerCase() };
}

function cmdGetText(params) {
  if (params.text) {
    const range = findRangeFor(params);
    if (range) return { ok: true, result: range.toString() };
    return { ok: false, error: '未找到文本：' + params.text };
  }
  const els = findElementsFor(params);
  if (!els.length) return { ok: false, error: '未找到目标元素' };
  const text = els.map((el) => (el.innerText || el.textContent || '').trim()).filter(Boolean).join('\n---\n').slice(0, 4000);
  return { ok: true, result: text || '（空内容）' };
}

export function executePageCommand(command, params) {
  params = params || {};
  switch (command) {
    case 'highlight': return cmdHighlight(params);
    case 'clear_highlights': resetPageCommands(); return { ok: true, result: '已清除页面高亮与样式' };
    case 'scroll_to': return cmdScrollTo(params);
    case 'scroll_by': return cmdScrollBy(params);
    case 'outline': return cmdOutline(params);
    case 'set_style': return cmdSetStyle(params);
    case 'click': return cmdClick(params);
    case 'get_text': return cmdGetText(params);
    default: return { ok: false, error: '未知页面命令：' + command };
  }
}
