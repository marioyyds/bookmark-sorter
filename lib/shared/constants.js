// 全局常量：类型、平台、星级、迁移映射（无依赖）

export const STORAGE_KEY = 'knowledgeBase';
export const LEGACY_STORAGE_KEY = 'wrongBook';
export const DATA_VERSION_KEY = 'knowledgeBaseDataVersion';
export const CURRENT_DATA_VERSION = 2;

// 状态常量枚举，避免魔法数字
export const STATUS = {
  GENERAL: 1, // 一般
  IMPORTANT: 2, // 重点
  FREQUENT: 3, // 高频
};

export const PLATFORMS = [
  { id: 'leetcode', name: 'LeetCode', match: /leetcode\.cn|leetcode\.com/i },
  { id: 'nowcoder', name: '牛客网', match: /nowcoder\.com/i },
  { id: 'luogu', name: '洛谷', match: /luogu\.com\.cn|luogu\.org/i },
  { id: 'acwing', name: 'AcWing', match: /acwing\.com/i },
  { id: 'codeforces', name: 'Codeforces', match: /codeforces\.com/i },
  { id: 'atcoder', name: 'AtCoder', match: /atcoder\.jp/i },
];

export const ITEM_TYPES = [
  { id: 'wrong', name: '算法错题', color: '#4a90d9' },
  { id: 'article', name: '技术文章', color: '#27ae60' },
  { id: 'ai', name: 'AI·Prompt', color: '#9b59b6' },
  { id: 'note', name: '笔记想法', color: '#e67e22' },
];

export const STAR_LEVELS = {
  [STATUS.GENERAL]: { name: '一般', color: '#f5b860' },
  [STATUS.IMPORTANT]: { name: '重点', color: '#f39c12' },
  [STATUS.FREQUENT]: { name: '高频', color: '#e74c3c' },
};

export const OLD_STATUS_MIGRATION = {
  'to-review': 2,
  'redo': 1,
  'mastered': 3,
};
