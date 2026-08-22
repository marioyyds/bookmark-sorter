// 页面正文提取：去除脚本/样式/导航等噪音后的纯文本（供 AI 上下文与 read_current_page 工具）
import { PAGE_TEXT_EXCLUDE } from './citation.js';

export function extractPageText() {
  try {
    const doc = document.body;
    if (!doc) return '';
    const clone = doc.cloneNode(true);
    clone
      .querySelectorAll(PAGE_TEXT_EXCLUDE)
      .forEach((el) => el.remove());
    let text = clone.innerText || '';
    text = text
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text.length > 6000) text = text.slice(0, 6000) + '……（页面内容过长，已截断）';
    return text;
  } catch (e) {
    return '';
  }
}
