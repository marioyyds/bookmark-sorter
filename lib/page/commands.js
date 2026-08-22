// 页面命令系统：结构化命令控制当前页面 DOM（高亮、滚动、改样式、点击、描边、读取）。
// 通过 chrome.runtime 消息由后台 Agent 工具（page_command）或用户直接调用。
import { normalizeCitationText, PAGE_TEXT_EXCLUDE, buildPageCharMap, findRangeBySubstr, makeOverlay, overlayColor, overlayRange } from './citation.js';
import { getInteractiveElementByRef } from './page-text.js';

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
  if (params.ref) {
    const el = getInteractiveElementByRef(params.ref);
    return el ? [el] : [];
  }
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

function firstTarget(params, includeText = true) {
  const source = params || {};
  const target = { ref: source.ref, selector: source.selector };
  if (includeText) target.text = source.text;
  const els = findElementsFor(target);
  return els.length ? els[0] : null;
}

function isVisibleForAction(el) {
  if (!el || !el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function editableValue(el) {
  if (!el) return null;
  if (el.isContentEditable) return String(el.textContent || '');
  if (typeof el.value === 'string') return el.value;
  return null;
}

function setNativeValue(el, value) {
  if (el.isContentEditable) {
    el.textContent = value;
    return;
  }
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) descriptor.set.call(el, value);
  else el.value = value;
}

function dispatchInputChange(el, text) {
  try {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
  } catch (e) {
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function cmdTypeText(params) {
  const el = firstTarget(params, false);
  if (!el) return { ok: false, error: '未找到可输入的目标元素' };
  const isEditable = el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
  if (!isEditable) return { ok: false, error: '目标元素不是 input、textarea 或 contenteditable' };
  if (el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') return { ok: false, error: '目标输入元素不可编辑' };
  if (el.tagName === 'INPUT' && ['file', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes((el.type || '').toLowerCase())) {
    return { ok: false, error: '不支持向该 input 类型输入文本：' + el.type };
  }
  const text = String(params.text === undefined || params.text === null ? '' : params.text);
  const before = editableValue(el) || '';
  const next = params.clearFirst === true ? text : before + text;
  try {
    setNativeValue(el, next);
    dispatchInputChange(el, text);
    el.focus();
  } catch (e) {
    return { ok: false, error: '输入文本失败：' + e.message };
  }
  return {
    ok: true,
    changed: before !== next,
    alreadySatisfied: before === next,
    valuePresent: Boolean(next),
    result: (params.clearFirst === true ? '已清空并输入 ' : '已输入 ') + text.length + ' 个字符',
  };
}

function keyCodeFor(key) {
  const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Space: 32 };
  return codes[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
}

function keyCodeName(key) {
  if (key.length === 1 && /^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
  if (key.length === 1 && /^\d$/.test(key)) return 'Digit' + key;
  return key;
}

function cmdPressKey(params) {
  const el = firstTarget(params, false) || (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body);
  if (!el) return { ok: false, error: '没有可接收键盘事件的目标元素' };
  const key = String(params.key || '');
  if (!key) return { ok: false, error: 'key 不能为空' };
  const modifiers = Array.isArray(params.modifiers) ? params.modifiers.map((x) => String(x).toUpperCase()) : [];
  const init = {
    key,
    code: keyCodeName(key),
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: modifiers.includes('CTRL'),
    altKey: modifiers.includes('ALT'),
    shiftKey: modifiers.includes('SHIFT'),
    metaKey: modifiers.includes('META'),
    keyCode: keyCodeFor(key),
    which: keyCodeFor(key),
  };
  try {
    if (el.focus) el.focus();
    const down = new KeyboardEvent('keydown', init);
    el.dispatchEvent(down);
    if (key.length === 1 || key === 'Enter' || key === 'Space') el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    // 合成 KeyboardEvent 不会自动触发浏览器默认行为；补齐最常用的 Enter/Space 行为。
    if (!down.defaultPrevented && (key === 'Enter' || key === 'Space')) {
      if (el.form && key === 'Enter' && typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
      else if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && el.click) el.click();
    }
  } catch (e) {
    return { ok: false, error: '键盘事件失败：' + e.message };
  }
  return { ok: true, eventDispatched: true, result: '已向目标元素派发按键：' + key };
}

function cmdSelectOption(params) {
  const el = firstTarget(params, false);
  if (!el) return { ok: false, error: '未找到 select 元素' };
  if (el.tagName !== 'SELECT') return { ok: false, error: '目标元素不是 select' };
  if (el.disabled) return { ok: false, error: 'select 元素不可用' };
  const options = Array.from(el.options || []);
  let index = -1;
  if (params.index !== undefined && params.index !== null) index = Number(params.index);
  else if (params.value !== undefined) index = options.findIndex((o) => o.value === String(params.value));
  else if (params.label !== undefined) index = options.findIndex((o) => String(o.textContent || '').trim() === String(params.label).trim());
  if (!Number.isInteger(index) || index < 0 || index >= options.length) return { ok: false, error: '未找到匹配的 option' };
  if (options[index].disabled) return { ok: false, error: '目标 option 已禁用' };
  const before = el.selectedIndex;
  try {
    el.selectedIndex = index;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  } catch (e) {
    return { ok: false, error: '选择 option 失败：' + e.message };
  }
  return {
    ok: true,
    changed: before !== el.selectedIndex,
    alreadySatisfied: before === el.selectedIndex,
    selectedIndex: el.selectedIndex,
    selectedLabel: String(options[index].textContent || '').trim().slice(0, 200),
    result: '已选择：' + String(options[index].textContent || '').trim().slice(0, 200),
  };
}

function cmdCheckBox(params) {
  const el = firstTarget(params, false);
  if (!el) return { ok: false, error: '未找到 checkbox 或 radio 元素' };
  const type = String(el.type || '').toLowerCase();
  const role = el.getAttribute('role');
  if (!['checkbox', 'radio'].includes(type) && role !== 'checkbox' && role !== 'radio') {
    return { ok: false, error: '目标元素不是 checkbox 或 radio' };
  }
  const desired = params.checked === true;
  const before = type ? Boolean(el.checked) : el.getAttribute('aria-checked') === 'true';
  if (type === 'radio' && !desired) return { ok: false, error: 'radio 不能切换为未选中' };
  if (before !== desired) {
    try { el.click(); } catch (e) { return { ok: false, error: '切换选项失败：' + e.message }; }
  }
  const after = type ? Boolean(el.checked) : el.getAttribute('aria-checked') === 'true';
  return { ok: true, changed: before !== after, alreadySatisfied: before === desired, checked: after, result: after ? '已选中' : '已取消选中' };
}

function waitStateMatches(el, params, state) {
  if (!el || !el.isConnected) return false;
  if (state === 'attached') return true;
  if (state === 'enabled') return isVisibleForAction(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  if (state === 'text_contains') return String(el.innerText || el.textContent || '').includes(String(params.text || ''));
  return isVisibleForAction(el);
}

function cmdWaitForElement(params) {
  if (!params.ref && !params.selector && !params.text) return Promise.resolve({ ok: false, matched: false, error: 'wait_for_element 需要 ref、selector 或 text' });
  const state = ['attached', 'visible', 'enabled', 'text_contains'].includes(params.state) ? params.state : 'visible';
  const timeoutMs = Math.min(15000, Math.max(100, Number(params.timeoutMs) || 8000));
  const pollMs = Math.min(1000, Math.max(25, Number(params.pollMs) || 100));
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let interval;
    let timeout;
    let observer;
    const cleanup = () => {
      clearInterval(interval);
      clearTimeout(timeout);
      if (observer) observer.disconnect();
    };
    const finish = (response) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };
    const check = () => {
      const el = firstTarget(params);
      if (el && waitStateMatches(el, params, state)) {
        finish({ ok: true, matched: true, result: '已等到目标元素（' + state + '）' });
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        finish({ ok: false, matched: false, error: '等待元素超时（' + timeoutMs + 'ms）' });
      }
    };
    interval = setInterval(check, pollMs);
    timeout = setTimeout(check, timeoutMs + 5);
    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      observer = new MutationObserver(check);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    check();
  });
}

function cmdGetAttribute(params) {
  const el = firstTarget(params, false);
  if (!el) return { ok: false, error: '未找到目标元素' };
  const attribute = String(params.attribute || '').trim().toLowerCase();
  if (!/^[a-zA-Z_:][a-zA-Z0-9:._-]*$/.test(attribute)) return { ok: false, error: '属性名无效' };
  const raw = el.getAttribute(attribute);
  const inputType = String(el.type || '').toLowerCase();
  const sensitive = attribute === 'value' && (inputType === 'password' || /cc-number|cc-csc|one-time-code/i.test(el.getAttribute('autocomplete') || ''));
  const value = sensitive ? null : raw === null ? null : String(raw).slice(0, 2000);
  return {
    ok: true,
    attribute,
    present: raw !== null,
    value,
    valueRedacted: sensitive,
    result: sensitive ? '属性存在，但敏感值已隐藏' : (raw === null ? '属性不存在：' + attribute : attribute + ' = ' + value),
  };
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

// 独立的浏览器 Agent 工具：参数丰富的表单/等待操作不塞进 page_command，
// 便于统一注册表做权限控制和参数校验。
export function typeText(params) { return cmdTypeText(params || {}); }
export function pressKey(params) { return cmdPressKey(params || {}); }
export function selectOption(params) { return cmdSelectOption(params || {}); }
export function checkBox(params) { return cmdCheckBox(params || {}); }
export function waitForElement(params) { return cmdWaitForElement(params || {}); }
export function getAttribute(params) { return cmdGetAttribute(params || {}); }
