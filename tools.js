// 工具定义（OpenAI / DeepSeek function-calling 格式）
// 后台以工具调用循环（agent loop）驱动：模型决定调用哪些工具，
// 后台执行真实操作（检索/增删知识库），再把结果喂回模型，直到产出最终回复。
const BUILTIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        '在用户的个人知识库中检索与查询相关的条目（算法错题、技术文章、AI·Prompt、笔记）。当用户问到知识库内容、要求基于收藏回答、或需要先查找相关资料时使用。',
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
      name: 'list_tabs',
      description: '列出当前浏览器窗口已打开的标签页（标题与 URL），用于定位用户正在看的资料。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_tab',
      description: '在新标签页打开一个 URL（如用户要求「打开某个链接/继续阅读」时）。',
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
        '对当前网页执行结构化 DOM 命令，用于高亮、定位、滚动、标注、点击或读取页面元素。当用户要求「高亮这段文字」「跳到某个标题」「把某块标出来」「点这个按钮」「改一下样式」等页面操作时使用。命令：highlight(高亮)、clear_highlights(清除)、scroll_to(滚动到)、scroll_by(按偏移滚动)、outline(描边标注)、set_style(临时改样式)、click(点击)、get_text(读取文本)。定位方式二选一：text(要匹配的文本片段) 或 selector(CSS 选择器)。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['highlight', 'clear_highlights', 'scroll_to', 'scroll_by', 'outline', 'set_style', 'click', 'get_text'],
            description: '要执行的命令名',
          },
          text: { type: 'string', description: '要定位的文本片段（与 selector 二选一）' },
          selector: { type: 'string', description: 'CSS 选择器（与 text 二选一）' },
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
];

// 工具本身声明风险等级，Agent 编排器据此决定是否需要用户确认。
// 这与 Vercel AI 的 tool 定义思路一致，避免在后台维护另一份易漂移的工具名单。
const TOOL_METADATA = {
  search_knowledge_base: { risk: 'read' },
  list_knowledge_base: { risk: 'read' },
  get_entry: { risk: 'read' },
  read_current_page: { risk: 'read' },
  list_tabs: { risk: 'read' },
  add_entry: { risk: 'write', requiresApproval: true },
  remove_entry: { risk: 'destructive', requiresApproval: true },
  open_tab: { risk: 'browser', requiresApproval: true },
  fetch_webpage: { risk: 'network', requiresApproval: true },
  page_command: { risk: 'page', requiresApproval: true },
};

function getToolMetadata(name) {
  if (typeof name === 'string' && name.indexOf('mcp__') === 0) {
    return { risk: 'external', requiresApproval: true };
  }
  return TOOL_METADATA[name] || { risk: 'unknown', requiresApproval: true };
}

const AGENT_SYSTEM_PROMPT = `你是一个具备工具调用能力的个人知识库 AI 助手。你可以使用以下工具：
- 检索、列出、查看、增删用户的个人知识库（算法错题、技术文章、AI·Prompt、笔记）；
- 读取当前浏览的网页正文（read_current_page）、列出/打开浏览器标签页、抓取外部网页（fetch_webpage）；
- 通过 page_command 对当前网页执行结构化命令：高亮(highlight)、清除(clear_highlights)、滚动(scroll_to/scroll_by)、描边(outline)、临时改样式(set_style)、点击(click)、读取元素文本(get_text)；
- 连接用户配置的 MCP 服务器（工具名以 mcp__ 开头），用于访问更多外部能力。

请优先用工具获取真实信息后再回答，不要编造不存在的内容。回答使用中文，可用 Markdown 排版；凡是依据知识库、当前页面或第三方网页证据的句子，都必须在对应句末使用 [n] 标注来源编号，不要只在回答末尾集中列出引用。当用户只是闲聊或明确无需工具时，直接回答即可。`;

/**
 * 执行单个工具调用
 * @param {string} name - 工具名
 * @param {Object} args - 参数
 * @param {Object} ctx - 运行上下文 { book, settings, page }
 * @returns {Promise<{result: string, citations?: Array, savedId?: string}>}
 */
async function executeTool(name, args, ctx) {
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
        const text = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: 'kbGetPageText' }, (r) => resolve(r && r.text ? r.text : ''));
        });
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
    case 'list_tabs': {
      try {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const text = tabs
          .filter((t) => t.url)
          .map((t, i) => `[${i + 1}] ${t.title || ''}｜${t.url}`)
          .join('\n');
        return { result: '当前窗口标签页：\n' + (text || '（无）') };
      } catch (e) {
        return { result: '列出标签页失败：' + e.message };
      }
    }
    case 'open_tab': {
      try {
        const t = await chrome.tabs.create({ url: args.url });
        return { result: '已在新标签页打开：' + (t && t.url ? t.url : args.url) };
      } catch (e) {
        return { result: '打开标签页失败：' + e.message };
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
        const res = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: 'kbPageCommand', command: args.command, params: args }, (r) => resolve(r));
        });
        if (!res) return { result: '页面命令无响应（内容脚本未注入或页面不支持）。' };
        if (res.ok === false) return { result: '页面命令「' + args.command + '」失败：' + (res.error || '未知错误') };
        return { result: res.result || '已执行页面命令：' + args.command };
      } catch (e) {
        return { result: '页面命令执行失败：' + e.message };
      }
    }
    default:
      return { result: '未知工具：' + name };
  }
}

function parseToolArgs(s) {
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

function splitIntoChunks(text, size, max) {
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

function stripHtml(html) {
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
