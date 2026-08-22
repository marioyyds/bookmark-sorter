// 工具定义（OpenAI / DeepSeek function-calling 格式）与内置工具执行
// 后台以工具调用循环（agent loop）驱动：模型决定调用哪些工具，
// 后台执行真实操作（检索/增删知识库），再把结果喂回模型，直到产出最终回复。
import { STATUS, STAR_LEVELS } from '../shared/constants.js';
import { typeInfo } from '../shared/utils.js';
import { getBook, upsertItem, deleteItem } from '../shared/store.js';
import { buildRagContext, buildCitations } from '../shared/rag.js';

// 工具 Schema 的唯一来源。对外暴露的 BUILTIN_TOOLS、权限查询和 MCP 工具列表
// 都从这里派生，避免 Agent / MCP / 执行器各维护一套不一致的参数定义。
const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        '在用户的个人知识库中检索与查询相关的条目（算法错题、技术文章、AI·Prompt、笔记）。当用户问到知识库内容、要求基于收藏回答，或需要先查找相关资料时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或自然语言问题' },
          limit: { type: 'integer', description: '返回条数上限，默认 5' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_knowledge_base',
      description: '列出知识库条目（可按类型筛选）。用于「知识库里有什么」「列出全部笔记」等概览类问题。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['wrong', 'article', 'ai', 'note', ''], description: '按类型筛选，留空表示全部' },
          limit: { type: 'integer', description: '返回条数上限，默认 20' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_entry',
      description: '按 id 获取单条知识库条目的完整内容（标题、备注、标签、链接、星级等）。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '条目 id（通常是其 URL）' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_entry',
      description: '向知识库新增或更新一条条目。可用于把对话中确认的知识点、总结、链接等保存下来。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['wrong', 'article', 'ai', 'note'], description: '条目类型' },
          title: { type: 'string', description: '标题' },
          url: { type: 'string', description: '相关链接（可选，无则留空）' },
          status: { type: 'integer', enum: [1, 2, 3], description: '星级 1一般 / 2重点 / 3高频' },
          note: { type: 'string', description: '备注或内容' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
        },
        required: ['type', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_entry',
      description: '从知识库删除一条条目。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '条目 id' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_current_page',
      description: '读取当前网页的正文内容（去除脚本/样式/导航等噪音后的纯文本）。当用户需要基于「正在浏览的页面」回答、总结或提取信息时调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_snapshot',
      description: '读取当前网页的结构化 DOM 快照，包括页面 URL、标题、正文摘要、可交互元素和滚动状态。页面操作前后可用它判断动作是否生效。',
      parameters: {
        type: 'object',
        properties: {
          maxElements: { type: 'integer', description: '最多返回多少个可交互元素，默认 60，最大 120' },
          maxText: { type: 'integer', description: '正文摘要最大字符数，默认 4000，最大 8000' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: '向当前网页的 input、textarea 或 contenteditable 元素输入文本。优先使用 DOM 快照中的 ref；默认追加文本，clearFirst=true 时先清空。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'DOM 快照中的元素引用，如 rf-3' },
          selector: { type: 'string', description: 'CSS 选择器（ref 不可用时使用）' },
          text: { type: 'string', description: '要输入的文本' },
          clearFirst: { type: 'boolean', description: '是否先清空原内容，默认 false' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: '向当前网页元素或当前焦点派发键盘按键，例如 Enter、Tab、Escape 或 Ctrl+A。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: '目标元素引用，可选；不填时使用当前焦点' },
          selector: { type: 'string', description: 'CSS 选择器，可选' },
          key: { type: 'string', description: '按键名称或单字符，如 Enter、Tab、a' },
          modifiers: { type: 'array', items: { type: 'string', enum: ['CTRL', 'ALT', 'SHIFT', 'META'] }, description: '修饰键列表' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select_option',
      description: '操作 select 下拉框。可按 option 的 value、label 或 index 选择。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'select 元素引用' },
          selector: { type: 'string', description: 'select 的 CSS 选择器' },
          value: { type: 'string', description: 'option.value' },
          label: { type: 'string', description: 'option 显示文本' },
          index: { type: 'integer', description: 'option 下标，从 0 开始' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_box',
      description: '勾选或取消 checkbox；radio 只能切换为 checked=true。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'checkbox/radio 元素引用' },
          selector: { type: 'string', description: 'checkbox/radio 的 CSS 选择器' },
          checked: { type: 'boolean', description: '目标状态' },
        },
        required: ['checked'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_for_element',
      description: '等待页面元素出现、可见、可用或包含指定文本。适合等待异步渲染和页面加载。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: '元素引用，可选' },
          selector: { type: 'string', description: 'CSS 选择器，可选' },
          text: { type: 'string', description: '目标文本，可选' },
          state: { type: 'string', enum: ['attached', 'visible', 'enabled', 'text_contains'], description: '等待条件，默认 visible' },
          timeoutMs: { type: 'integer', description: '最长等待时间，默认 8000，最大 15000' },
          pollMs: { type: 'integer', description: '轮询间隔，默认 100' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_attribute',
      description: '读取当前网页元素的 HTML 属性，例如 disabled、aria-expanded、href、data-state。密码字段不会返回实际值。',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: '元素引用' },
          selector: { type: 'string', description: 'CSS 选择器' },
          attribute: { type: 'string', description: '属性名，如 aria-expanded、href、disabled' },
        },
        required: ['attribute'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: '列出当前浏览器窗口已打开的标签页（标题与 URL），用于定位用户正在看的资料。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_tab',
      description: '切换当前 Agent 后续操作要控制的标签页。tabId 来自 list_tabs 或 open_tab 的结果。',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'integer', description: '目标标签页 ID' },
        },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_tab',
      description: '在新标签页打开一个 URL，并自动把后续 DOM 操作绑定到新标签页。',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '要打开的链接' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_webpage',
      description: '抓取并提取任意公开网页的正文文本（简易爬虫）。用于获取知识库或当前页之外的外部资料。注意：目标站点需在插件 host_permissions 中授权。',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '目标网页 URL' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'page_command',
      description:
        '对当前网页执行结构化 DOM 命令，用于高亮、定位、滚动、标注、点击或读取页面元素。当用户要求「高亮这段文字」「跳到某个标题」「把某块标出来」「点这个按钮」「改一下样式」等页面操作时使用。命令：highlight(高亮)、clear_highlights(清除)、scroll_to(滚动到)、scroll_by(按偏移滚动)、outline(描边标注)、set_style(临时改样式)、click(点击)、get_text(读取文本)。定位方式优先使用 DOM 快照中的 ref，也可使用 text(文本片段) 或 selector(CSS 选择器)。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['highlight', 'clear_highlights', 'scroll_to', 'scroll_by', 'outline', 'set_style', 'click', 'get_text'],
            description: '要执行的命令名',
          },
          ref: { type: 'string', description: 'DOM 快照中的元素引用，如 rf-3（优先使用）' },
          text: { type: 'string', description: '要定位的文本片段（与 selector/ref 二选一）' },
          selector: { type: 'string', description: 'CSS 选择器（与 text/ref 二选一）' },
          color: { type: 'string', description: '高亮/描边颜色，如 #ff0000 或 rgba(255,0,0,.4)' },
          styles: { type: 'object', description: 'set_style 要应用的样式对象，如 {"backgroundColor":"#fff3a3"}' },
          top: { type: 'number', description: 'scroll_to 的目标纵坐标(px)' },
          left: { type: 'number', description: 'scroll_to 的目标横坐标(px)' },
          x: { type: 'number', description: 'scroll_by 横向偏移(px)' },
          y: { type: 'number', description: 'scroll_by 纵向偏移(px)' },
          behavior: { type: 'string', enum: ['auto', 'smooth'], description: '滚动行为，默认 smooth' },
          block: { type: 'string', enum: ['start', 'center', 'end'], description: '滚动对齐方式，默认 start' },
          duration: { type: 'integer', description: '临时效果持续时间(ms)，默认 1500' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description:
        '声明当前用户任务已完成并给出简短总结。当目标页面已打开、内容已给出或操作已完成后，立即调用本工具结束任务；不要在完成后继续调用其他工具。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '一句话总结完成结果，例如「已打开《凡人修仙传》详情页」' },
          evidence: { type: 'string', description: '可选：完成证据，例如页面标题、URL 或关键内容' },
        },
        required: ['summary'],
      },
    },
  },
];

// 工具本身声明风险等级，Agent 编排器据此决定是否需要用户确认。
// 这与 Vercel AI 的 tool 定义思路一致，避免在后台维护另一份易漂移的工具名单。
const TOOL_METADATA = {
  search_knowledge_base: { risk: 'read', readOnly: true, route: 'background' },
  list_knowledge_base: { risk: 'read', readOnly: true, route: 'background' },
  get_entry: { risk: 'read', readOnly: true, route: 'background' },
  read_current_page: { risk: 'read', readOnly: true, route: 'content' },
  get_page_snapshot: { risk: 'read', readOnly: true, route: 'content' },
  type_text: { risk: 'page', requiresApproval: true, route: 'content' },
  press_key: { risk: 'page', requiresApproval: true, route: 'content' },
  select_option: { risk: 'page', requiresApproval: true, route: 'content' },
  check_box: { risk: 'page', requiresApproval: true, route: 'content' },
  wait_for_element: { risk: 'read', readOnly: true, route: 'content' },
  get_attribute: { risk: 'read', readOnly: true, route: 'content' },
  list_tabs: { risk: 'read', readOnly: true, route: 'background' },
  switch_tab: { risk: 'browser', requiresApproval: true, route: 'background' },
  add_entry: { risk: 'write', requiresApproval: true, route: 'background' },
  remove_entry: { risk: 'destructive', requiresApproval: true, route: 'background' },
  open_tab: { risk: 'browser', requiresApproval: true, route: 'background' },
  fetch_webpage: { risk: 'network', requiresApproval: true, route: 'background' },
  page_command: { risk: 'page', requiresApproval: true, route: 'content' },
  complete_task: { risk: 'read', readOnly: true, route: 'background' },
};

export const TOOL_REGISTRY = Object.freeze(
  TOOL_SCHEMAS.map((tool) => {
    const name = tool.function.name;
    const metadata = TOOL_METADATA[name] || { risk: 'unknown', requiresApproval: true, route: 'background' };
    return Object.freeze({
      name,
      description: tool.function.description,
      inputSchema: tool.function.parameters,
      risk: metadata.risk,
      requiresApproval: metadata.requiresApproval === true,
      readOnly: metadata.readOnly === true,
      route: metadata.route || 'background',
      openai: tool,
    });
  })
);

const TOOL_BY_NAME = new Map(TOOL_REGISTRY.map((tool) => [tool.name, tool]));
export const BUILTIN_TOOLS = TOOL_REGISTRY.map((tool) => tool.openai);

export function getToolDefinition(name) {
  return TOOL_BY_NAME.get(name) || null;
}

export function getToolMetadata(name) {
  if (typeof name === 'string' && name.indexOf('mcp__') === 0) {
    return { risk: 'external', requiresApproval: true };
  }
  const definition = getToolDefinition(name);
  return definition
    ? { risk: definition.risk, requiresApproval: definition.requiresApproval, readOnly: definition.readOnly, route: definition.route }
    : { risk: 'unknown', requiresApproval: true, readOnly: false, route: 'background' };
}

/**
 * 对模型返回的工具参数做最小结构校验。完整 JSON Schema 校验留给后续，
 * 这里先保证未知工具、非对象参数和 required 字段不会直接进入执行器。
 */
export function validateToolCall(name, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: '工具参数必须是 JSON 对象。' };
  }
  const definition = getToolDefinition(name);
  if (!definition) {
    if (typeof name === 'string' && name.indexOf('mcp__') === 0) return { ok: true };
    return { ok: false, error: '未知工具：' + name };
  }
  const required = definition.inputSchema && Array.isArray(definition.inputSchema.required)
    ? definition.inputSchema.required
    : [];
  const missing = required.filter((key) => args[key] === undefined || args[key] === null || args[key] === '');
  return missing.length
    ? { ok: false, error: '工具「' + name + '」缺少必填参数：' + missing.join('、') }
    : { ok: true };
}

export const AGENT_SYSTEM_PROMPT = `你是一个具备工具调用能力的个人知识库 AI 助手。你可以使用以下工具：
- 检索、列出、查看、增删用户的个人知识库（算法错题、技术文章、AI·Prompt、笔记）；
- 读取当前浏览的网页正文（read_current_page）或结构化 DOM 快照（get_page_snapshot）、列出/打开/切换浏览器标签页、抓取外部网页（fetch_webpage）；
- 通过 type_text、press_key、select_option、check_box 操作表单，通过 wait_for_element 等待异步页面，通过 get_attribute 读取元素状态；
- 通过 page_command 对当前网页执行结构化命令：高亮(highlight)、清除(clear_highlights)、滚动(scroll_to/scroll_by)、描边(outline)、临时改样式(set_style)、点击(click)、读取元素文本(get_text)；
- 连接用户配置的 MCP 服务器（工具名以 mcp__ 开头），用于访问更多外部能力。

请优先用工具获取真实信息后再回答，不要编造不存在的内容。回答使用中文，可用 Markdown 排版；凡是依据知识库、当前页面或第三方网页证据的句子，都必须在对应句末使用 [n] 标注来源编号，不要只在回答末尾集中列出引用。当用户只是闲聊或明确无需工具时，直接回答即可。`;

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function getPageSnapshot(tabId, options = {}) {
  if (!tabId) return null;
  const snapshot = await sendTabMessage(tabId, { type: 'kbGetPageSnapshot', options });
  return snapshot && snapshot.version ? snapshot : null;
}

async function waitForTabReady(tabId, timeoutMs = 8000) {
  const deadline = Date.now() + Math.min(12000, Math.max(500, timeoutMs));
  while (Date.now() < deadline) {
    const snapshot = await getPageSnapshot(tabId, { maxElements: 30, maxText: 800 }).catch(() => null);
    if (snapshot) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

function verifyPageAction(command, before, after, response) {
  const executed = Boolean(response && response.ok !== false);
  const urlChanged = Boolean(before && after && before.url !== after.url);
  const contentChanged = Boolean(before && after && before.fingerprint !== after.fingerprint);
  const scrollChanged = Boolean(before && after && before.scroll && after.scroll &&
    (before.scroll.x !== after.scroll.x || before.scroll.y !== after.scroll.y));
  const visualOnly = ['highlight', 'outline', 'set_style', 'clear_highlights'].includes(command);
  const responseChanged = Boolean(response && (response.changed || response.hadEffect));
  const responseSatisfied = Boolean(response && response.alreadySatisfied);
  const eventOnly = command === 'press_key';
  const changed = urlChanged || contentChanged || scrollChanged || responseChanged;
  let reason = executed ? '动作已执行' : '页面命令返回失败';
  if (command === 'click' && executed && !changed) reason = '点击已派发，但页面快照暂未观察到变化';
  if (command.indexOf('scroll') === 0 && executed && !scrollChanged) reason = '滚动已派发，但滚动位置未变化';
  if (visualOnly && executed) reason = '视觉标注动作已执行；标注层不计入内容指纹';
  if (command === 'type_text' && executed && responseSatisfied) reason = '目标输入已处于要求状态';
  else if (command === 'type_text' && executed && !changed) reason = '输入事件已派发，但快照未观察到值状态变化';
  if (command === 'press_key' && executed) reason = '键盘事件已派发';
  return {
    executed,
    verified: executed && (changed || responseSatisfied || visualOnly || eventOnly || command === 'get_text'),
    changed,
    urlChanged,
    contentChanged,
    scrollChanged,
    reason,
  };
}

// 把 DOM 快照压缩成给模型看的短摘要：标题、URL、关键元素、正文开头。
function compactSnapshotSummary(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  const title = String(snapshot.title || '');
  const url = String(snapshot.url || '');
  const elements = Array.isArray(snapshot.elements)
    ? snapshot.elements
        .slice(0, 8)
        .map((e) => {
          const label = e.label || e.placeholder || '';
          return e.ref + (label ? '：' + String(label).slice(0, 24) : '');
        })
        .join('；')
    : '';
  const text = String(snapshot.text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return ['页面标题：' + title, '页面URL：' + url, elements ? '关键元素：' + elements : '', text ? '正文摘要：' + text : '']
    .filter(Boolean)
    .join('\n');
}

async function executeContentAction(tabId, action, message, options = {}) {
  if (!tabId) return { ok: false, result: '无法定位当前标签页（可能不在前台页面）。' };
  const shouldVerify = options.verify !== false;
  const before = shouldVerify ? await getPageSnapshot(tabId, { maxElements: 50, maxText: 1600 }).catch(() => null) : null;
  const response = await sendTabMessage(tabId, message);
  if (!response) return { ok: false, result: '页面内容脚本无响应或尚未注入。' };
  if (response.ok === false) return { ok: false, result: response.error || response.result || ('页面动作失败：' + action) };
  if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
  let after = shouldVerify ? await getPageSnapshot(tabId, { maxElements: 50, maxText: 1600 }).catch(() => null) : null;
  if (shouldVerify && !after && before) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && tab.url) after = { version: 1, url: tab.url, title: tab.title || '', fingerprint: 'navigation:' + tab.url, scroll: null };
  }
  const verification = shouldVerify
    ? verifyPageAction(action, before, after, response)
    : { executed: true, verified: true, changed: false, reason: '读取类工具无需页面变化验证' };
  return {
    ...response,
    ok: true,
    hadEffect: Boolean(verification.changed),
    result: (response.result || ('已执行页面动作：' + action)) + (shouldVerify ? '\n验证：' + verification.reason : ''),
    verification,
    pageSnapshot: after,
  };
}

/**
 * 执行单个工具调用
 * @param {string} name - 工具名
 * @param {Object} args - 参数
 * @param {Object} ctx - 运行上下文 { book, settings, page }
 * @returns {Promise<{result: string, citations?: Array, savedId?: string}>}
 */
export async function executeTool(name, args, ctx) {
  args = args || {};
  switch (name) {
    case 'search_knowledge_base': {
      const limit = Number(args.limit) || 5;
      const relevant = buildRagContext(ctx.book, args.query || '', limit);
      if (!relevant.length) return { result: '未检索到相关知识库条目。' };
      const citations = buildCitations(relevant, false);
      const text = relevant
        .map(
          (it, i) =>
            `[${i + 1}] 标题：${it.title}｜类型：${typeInfo(it.type).name}` +
            `${it.note ? '｜内容：' + it.note : ''}${it.url ? '｜链接：' + it.url : ''}`
        )
        .join('\n');
      return { result: '检索到的知识库条目：\n' + text, citations };
    }
    case 'list_knowledge_base': {
      let items = Object.values(ctx.book);
      if (args.type) items = items.filter((it) => it.type === args.type);
      items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      const limit = Number(args.limit) || 20;
      const shown = items.slice(0, limit);
      const text = shown
        .map(
          (it, i) =>
            `[${i + 1}] 标题：${it.title}｜类型：${typeInfo(it.type).name}` +
            `${it.tags && it.tags.length ? '｜标签：' + it.tags.join('、') : ''}`
        )
        .join('\n');
      return { result: `知识库共 ${items.length} 条，以下列出 ${shown.length} 条：\n` + (text || '（空）'), citations: buildCitations(shown, true) };
    }
    case 'get_entry': {
      const it = ctx.book[args.id];
      if (!it) return { result: '未找到该条目（id: ' + args.id + '）。' };
      return {
        result:
          `标题：${it.title}\n类型：${typeInfo(it.type).name}\n` +
          `星级：${(STAR_LEVELS[it.status] || {}).name || it.status}\n` +
          `标签：${(it.tags || []).join('、') || '无'}\n备注：${it.note || '无'}\n链接：${it.url || '无'}`,
      };
    }
    case 'add_entry': {
      const id = args.url || 'kb:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
      const created = await upsertItem({
        id,
        type: args.type || 'note',
        title: args.title || '未命名',
        url: args.url || '',
        status: args.status || STATUS.IMPORTANT,
        note: args.note || '',
        tags: Array.isArray(args.tags) ? args.tags : [],
      });
      ctx.book = await getBook();
      return { result: `已保存条目：标题「${created.title}」(id: ${created.id})。`, savedId: created.id };
    }
    case 'remove_entry': {
      if (!ctx.book[args.id]) return { result: '未找到该条目，无需删除。' };
      await deleteItem(args.id);
      ctx.book = await getBook();
      return { result: '已删除条目 (id: ' + args.id + ')。' };
    }
    case 'read_current_page': {
      const tabId = ctx.tabId;
      if (!tabId) return { result: '无法定位当前标签页（可能不在前台页面）。' };
      try {
        const pageResponse = await sendTabMessage(tabId, { type: 'kbGetPageText' });
        const text = pageResponse && pageResponse.text ? pageResponse.text : '';
        if (!text) return { result: '未能读取页面正文（内容脚本未注入或页面不支持）。' };
        const chunks = splitIntoChunks(text, 600, 6);
        const result =
          chunks.length > 1
            ? '当前页面正文（分块，可引用 [n]）：\n' + chunks.map((c, i) => '[' + (i + 1) + '] ' + c).join('\n\n')
            : '当前页面正文：\n' + text;
        const citations = chunks.map((c, i) => ({
          index: i + 1,
          source: 'page',
          title: c.replace(/\s+/g, ' ').trim().slice(0, 40),
          url: ctx.pageUrl || '',
          snippet: c,
        }));
        return { result, citations };
      } catch (e) {
        return { result: '读取页面失败：' + e.message };
      }
    }
    case 'get_page_snapshot': {
      const tabId = ctx.tabId;
      if (!tabId) return { ok: false, result: '无法定位当前标签页（可能不在前台页面）。' };
      try {
        const snapshot = await getPageSnapshot(tabId, args);
        if (!snapshot) return { ok: false, result: '未能读取 DOM 快照（内容脚本未注入或页面不支持）。' };
        return {
          ok: true,
          hadEffect: false,
          snapshot,
          result: '当前页面 DOM 快照：\n' + JSON.stringify(snapshot),
        };
      } catch (e) {
        return { ok: false, result: '读取 DOM 快照失败：' + e.message };
      }
    }
    case 'type_text': {
      try {
        return await executeContentAction(ctx.tabId, 'type_text', { type: 'kbTypeText', params: args }, { delayMs: 80 });
      } catch (e) {
        return { ok: false, result: '输入文本失败：' + e.message };
      }
    }
    case 'press_key': {
      try {
        return await executeContentAction(ctx.tabId, 'press_key', { type: 'kbPressKey', params: args }, { delayMs: 120 });
      } catch (e) {
        return { ok: false, result: '派发键盘事件失败：' + e.message };
      }
    }
    case 'select_option': {
      try {
        return await executeContentAction(ctx.tabId, 'select_option', { type: 'kbSelectOption', params: args }, { delayMs: 100 });
      } catch (e) {
        return { ok: false, result: '选择下拉项失败：' + e.message };
      }
    }
    case 'check_box': {
      try {
        return await executeContentAction(ctx.tabId, 'check_box', { type: 'kbCheckBox', params: args }, { delayMs: 100 });
      } catch (e) {
        return { ok: false, result: '切换复选框失败：' + e.message };
      }
    }
    case 'wait_for_element': {
      try {
        return await executeContentAction(ctx.tabId, 'wait_for_element', { type: 'kbWaitForElement', params: args }, { verify: false });
      } catch (e) {
        return { ok: false, result: '等待元素失败：' + e.message };
      }
    }
    case 'get_attribute': {
      try {
        return await executeContentAction(ctx.tabId, 'get_attribute', { type: 'kbGetAttribute', params: args }, { verify: false });
      } catch (e) {
        return { ok: false, result: '读取属性失败：' + e.message };
      }
    }
    case 'list_tabs': {
      try {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const visibleTabs = tabs.filter((t) => t.url);
        const tabInfo = visibleTabs.map((t) => ({
          tabId: t.id,
          windowId: t.windowId,
          title: t.title || '',
          url: t.url || '',
          active: Boolean(t.active),
        }));
        const text = visibleTabs
          .filter((t) => t.url)
          .map((t, i) => `[${i + 1}] tabId=${t.id} ${t.active ? '（当前）' : ''} ${t.title || ''}｜${t.url}`)
          .join('\n');
        return { ok: true, tabs: tabInfo, result: '当前窗口标签页：\n' + (text || '（无）') };
      } catch (e) {
        return { ok: false, result: '列出标签页失败：' + e.message };
      }
    }
    case 'switch_tab': {
      const tabId = Number(args.tabId);
      if (!Number.isInteger(tabId) || tabId <= 0) return { ok: false, result: 'tabId 必须是有效的标签页 ID' };
      try {
        const target = await chrome.tabs.get(tabId);
        if (!target || !target.id) return { ok: false, result: '未找到标签页：' + tabId };
        await chrome.tabs.update(tabId, { active: true });
        const snapshot = await waitForTabReady(tabId, 5000);
        const current = await chrome.tabs.get(tabId).catch(() => target);
        const targetTab = {
          tabId,
          windowId: current.windowId || target.windowId,
          title: current.title || target.title || '',
          url: current.url || target.url || '',
          ready: Boolean(snapshot),
        };
        return {
          ok: true,
          targetTabId: tabId,
          targetTab,
          pageSnapshot: snapshot,
          result: '已切换到标签页 tabId=' + tabId + '：' + (target.title || target.url || '') + (snapshot ? '（页面已就绪）' : '（内容脚本尚未就绪）'),
        };
      } catch (e) {
        return { ok: false, result: '切换标签页失败：' + e.message };
      }
    }
    case 'open_tab': {
      try {
        const t = await chrome.tabs.create({ url: args.url });
        if (!t || !t.id) return { ok: false, result: '打开标签页失败：浏览器未返回 tabId' };
        const snapshot = await waitForTabReady(t.id, 8000);
        const current = await chrome.tabs.get(t.id).catch(() => t);
        const targetTab = {
          tabId: t.id,
          windowId: current.windowId || t.windowId,
          title: current.title || t.title || '',
          url: (current.url || t.url || args.url || ''),
          ready: Boolean(snapshot),
        };
        return {
          ok: true,
          targetTabId: t.id,
          targetTab,
          pageSnapshot: snapshot,
          result: '已在新标签页打开并绑定：tabId=' + t.id + ' ' + (t.url || args.url) + (snapshot ? '（页面已就绪）' : '（内容脚本尚未就绪）'),
        };
      } catch (e) {
        return { ok: false, result: '打开标签页失败：' + e.message };
      }
    }
    case 'fetch_webpage': {
      try {
        const u = String(args.url || '');
        if (!/^https?:\/\//i.test(u)) return { result: '仅支持 http/https 链接：' + u };
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
        const resp = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined });
        if (timer) clearTimeout(timer);
        if (!resp.ok) return { result: '抓取失败 (' + resp.status + ')：' + u };
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (ct && !/^(text\/html|text\/plain|application\/xml|application\/xhtml|\+xml)/.test(ct) && !ct.includes('json')) {
          return { result: '跳过非文本页面（' + ct + '）：' + u };
        }
        const maxBytes = 1.5 * 1024 * 1024;
        const buf = await readBounded(resp.body, maxBytes);
        const decoder = decodeBuffer(ct);
        const raw = decoder.decode(buf);
        const truncated = buf.byteLength >= maxBytes;
        const text = stripHtml(raw).slice(0, 8000);
        const finalUrl = resp.url || u;
        return {
          result: '网页正文（' + finalUrl + '）：\n' + text + (truncated ? '\n（内容过大已截断）' : ''),
          citations: [{ index: 1, source: 'web', title: finalUrl, url: finalUrl, snippet: text.slice(0, 180) }],
        };
      } catch (e) {
        return {
          result:
            '抓取网页失败：' + e.message + '（若为目标站跨域，请将其域名加入 manifest.json 的 host_permissions；或改用 MCP fetch 服务器以突破浏览器跨域限制）',
        };
      }
    }
    case 'page_command': {
      const tabId = ctx.tabId;
      if (!tabId) return { result: '无法定位当前标签页（可能不在前台页面）。' };
      try {
        const command = String(args.command || '');
        const shouldVerify = ['click', 'scroll_to', 'scroll_by', 'set_style'].includes(command);
        // 点击前记录现有标签页，点击后用于检测 target="_blank" 新建的标签页并自动绑定。
        const beforeTabs = command === 'click' ? await chrome.tabs.query({ currentWindow: true }).catch(() => null) : null;
        const before = shouldVerify ? await getPageSnapshot(tabId, { maxElements: 40, maxText: 1200 }).catch(() => null) : null;
        const res = await sendTabMessage(tabId, { type: 'kbPageCommand', command, params: args });
        if (!res) return { result: '页面命令无响应（内容脚本未注入或页面不支持）。' };
        if (res.ok === false) return { ok: false, result: '页面命令「' + command + '」失败：' + (res.error || '未知错误') };
        // 给 React/Vue 等页面留出一小段时间完成异步更新，再读取后快照。
        if (shouldVerify) await new Promise((resolve) => setTimeout(resolve, command === 'click' ? 320 : 160));
        let after = shouldVerify ? await getPageSnapshot(tabId, { maxElements: 40, maxText: 1200 }).catch(() => null) : null;
        // 点击触发导航时，旧内容脚本可能已卸载；此时至少用 Tab URL 判断导航是否发生。
        if (shouldVerify && !after && before) {
          const tab = await chrome.tabs.get(tabId).catch(() => null);
          if (tab && tab.url) after = { version: 1, url: tab.url, title: tab.title || '', fingerprint: 'navigation:' + tab.url, scroll: null };
        }
        // 点击 target="_blank" 结果链接会新建标签页：检测到新 Tab 后自动绑定到上下文，
        // 模型后续直接 get_page_snapshot 即可，不再需要 list_tabs + switch_tab。
        if (command === 'click' && beforeTabs && Array.isArray(beforeTabs)) {
          const existingIds = new Set(beforeTabs.map((t) => t.id));
          const nowTabs = await chrome.tabs.query({ currentWindow: true }).catch(() => []);
          const newTab = nowTabs.find((t) => t.id && !existingIds.has(t.id));
          if (newTab && newTab.id) {
            const snap = await waitForTabReady(newTab.id, 7000);
            const current = await chrome.tabs.get(newTab.id).catch(() => newTab);
            const targetTab = {
              tabId: newTab.id,
              windowId: current.windowId || newTab.windowId,
              title: current.title || newTab.title || '',
              url: current.url || newTab.url || '',
              ready: Boolean(snap),
            };
            ctx.tabId = newTab.id;
            ctx.pageUrl = targetTab.url || ctx.pageUrl;
            ctx.pageTitle = targetTab.title || ctx.pageTitle;
            return {
              ok: true,
              hadEffect: true,
              targetTabId: newTab.id,
              targetTab,
              pageSnapshot: snap,
              result:
                '点击已派发，检测到新标签页并已自动绑定：tabId=' + newTab.id + ' ' + targetTab.url +
                (snap ? '\n' + compactSnapshotSummary(snap) + '\n（页面已就绪，可直接据此判断任务是否完成）' : '（内容脚本尚未就绪）'),
            };
          }
        }
        const verification = shouldVerify ? verifyPageAction(command, before, after, res) : { executed: true, verified: true, changed: false, reason: '读取类/视觉类命令无需内容验证' };
        if (after && after.url) {
          ctx.pageUrl = after.url || ctx.pageUrl;
          ctx.pageTitle = after.title || ctx.pageTitle;
        }
        return {
          ok: true,
          hadEffect: Boolean(verification.changed),
          result:
            (res.result || '已执行页面命令：' + command) +
            '\n验证：' + verification.reason +
            (command === 'click' && after ? '\n' + compactSnapshotSummary(after) : ''),
          verification,
          pageSnapshot: after,
        };
      } catch (e) {
        return { ok: false, result: '页面命令执行失败：' + e.message };
      }
    }
    case 'complete_task': {
      const summary = String(args.summary || '任务完成。');
      const evidence = args.evidence ? String(args.evidence) : '';
      return { result: '任务已完成：' + summary + (evidence ? '\n证据：' + evidence : ''), complete: true };
    }
    default:
      return { result: '未知工具：' + name };
  }
}

export function parseToolArgs(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return {};
  }
}

// 限制读取体积，避免大页面撑爆内存（最多 maxBytes，超出即截断并 cancel）
async function readBounded(body, maxBytes) {
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      const remaining = maxBytes - total;
      if (remaining > 0) chunks.push(value.subarray(0, remaining));
      total = maxBytes;
      try {
        await reader.cancel();
      } catch (e) {}
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function decodeBuffer(buf, contentType) {
  const charset = ((contentType || '').match(/charset=([\w-]+)/i) || [])[1];
  try {
    return new TextDecoder((charset || 'utf-8').trim().toLowerCase());
  } catch (e) {
    return new TextDecoder('utf-8');
  }
}

export function splitIntoChunks(text, size, max) {
  const s = String(text || '').trim();
  if (!s) return [];
  const paras = s.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return [s.slice(0, size)];

  const chunks = [];
  let buf = '';
  const push = (str) => {
    const t = str.replace(/\n+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
    if (!t || chunks.length >= max) return;
    if (t.length > size * 1.5) {
      const parts = t.match(new RegExp('.{1,' + size + '}', 'g')) || [t];
      for (const pt of parts) {
        if (chunks.length >= max) break;
        chunks.push(pt.trim());
      }
    } else {
      chunks.push(t);
    }
  };

  for (const p of paras) {
    const candidate = buf ? buf + '\n\n' + p : p;
    if (buf && candidate.length > size) {
      push(buf);
      buf = p;
      if (chunks.length >= max) break;
    } else {
      buf = candidate;
    }
  }
  push(buf);
  return chunks.slice(0, max);
}

export function stripHtml(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  // 块级标签转为换行，保留段落结构
  s = s.replace(/<(br|p|div|li|tr|h[1-6]|section|article)[\s\/>]/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  // 常见 HTML 实体
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, ' ');
  s = s.replace(/[ \t]+/g, ' ').replace(/[ \r]+/g, '').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
