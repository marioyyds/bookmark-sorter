// AI 设置：默认值、读取（与存储层解耦，content script 只依赖本模块）

export const AI_SETTINGS_KEY = 'aiSettings';

export const AI_SETTINGS_DEFAULTS = {
  apiKey: '',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
  requestTimeoutMs: 60000,
  ragEnabled: true,
  targetLang: '中文',
  pageContext: true,
  // Cline 风格：可能改变数据、浏览器状态或调用外部 MCP 的工具必须先由用户确认。
  toolApproval: true,
  quickPrompts: ['总结全文', '翻译成中文', '解释这段内容', '提炼关键要点'],
  mcpServers: [],
};

export async function getAISettings() {
  const d = await chrome.storage.local.get(AI_SETTINGS_KEY);
  return Object.assign({}, AI_SETTINGS_DEFAULTS, d[AI_SETTINGS_KEY] || {});
}
