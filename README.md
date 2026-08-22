<p align="center">
  <img src="./icons/recallflow-github-logo.svg" alt="RecallFlow logo" width="480">
</p>

# RecallFlow

**面向 AI 时代的个人知识库 + 网页 Agent** —— 统一收录算法错题、技术文章、AI Prompt 与笔记，并在任意网页上驱动 AI 完成划词问答、翻译、总结与结构化页面操作。

[![Platform](https://img.shields.io/badge/Platform-Microsoft%20Edge-blue.svg?style=flat-square)](https://www.microsoft.com/edge)
[![Manifest V3](https://img.shields.io/badge/Manifest-v3-blue.svg?style=flat-square)](manifest.json)
[![GitHub Repo](https://img.shields.io/badge/Repo-GitHub-blue.svg?style=flat-square)](https://github.com/marioyyds/bookmark-sorter)

---

## Why RecallFlow?

管理知识和利用网页，通常要做两件麻烦事：**把信息收藏整理**、**靠人工在页面上划词、滚动、点击**。RecallFlow 把这两件都交给 AI 接起来，开箱即用：

- **一键收录** — 打开网页即收藏，支持类型分类、星级、标签与全文搜索，数据全存本地。
- **划词即问** — 选中任意文字即可让 AI 翻译、解释、总结、补全，回答自动结合整页上下文。
- **RAG 知识库检索** — AI 基于你的收藏回答，而不是凭空猜测。
- **网页 Agent 操作** — AI 能对当前页面直接执行高亮、滚动、描边、点击等结构化命令。
- **MCP 扩展** — 连接自建/第三方 MCP 服务器，接入文件、联网、Notion 等任意工具。
- **隐私优先** — 数据保存在本地 `chrome.storage.local`，仅 API Key 会连接 DeepSeek。

## 功能

### 知识库

| 类型 | 说明 |
| --- | --- |
| `算法错题` | 打开 LeetCode / 牛客 / 洛谷等题目页自动识别，标记错题星级 |
| `技术文章` | 剪藏博客、论文、文档链接 |
| `AI·Prompt` | 收藏 AI 工具、提示词、优质对话 |
| `笔记想法` | 不依赖网页，手动写笔记 |

- **星级分级**：`★☆☆ 一般 / ★★☆ 重点 / ★★★ 高频`，点击星星即可评级
- **自定义标签**：逗号分隔打标签，支持按标签筛选
- **统计与排序**：总数 + 各星级统计卡片，多维排序
- **完整管理页**：类型 Tab、标签筛选、全文搜索、内联编辑、JSON 导入导出
- **深色模式**：自动跟随系统；**数据迁移**：旧版「算法错题集」数据自动迁移

### RecallFlow（DeepSeek）

- **右下角悬浮助手**：常驻「AI」圆形按钮，点击展开/收起对话面板
- **划词悬浮**：选中任意文字出现「RecallFlow」气泡，点击展开对话
- **自由指令**：不限定固定操作（「翻译成英文」「解释这段代码」「优化并补全」「写一份总结」），AI 基于选中文本执行
- **多轮对话**：聊天流展示、可连续追问、记住上下文、自动保存、可一键清空
- **结合整页内容**：回答自动参考当前网页正文，而不只局限于选中的文字（可在设置里开关）
- **RAG 知识库检索**：自动把相关知识库条目作为上下文（可在设置里开关）
- **中断生成**：流式回复过程可「停止」，已生成内容保留
- **可审计工具流**：面板展示 Agent 工具调用开始/完成状态，文本与工具事件分离
- **结构化对话记录**：保存文本、工具调用与结果，重开面板可回溯
- **对话撤销**：可撤销某条指令及其后续回答，再从此前上下文继续
- **工具审批**：增删知识库、打开/抓取网页、调用 MCP 工具前暂停确认（可在设置关闭）
- **对话快捷语句**：提供「总结全文」「翻译成中文」等快捷按钮，可自定义
- **自适应窗口**：悬浮模式下回复时高度随内容伸缩，贴合右下角

### 页面命令系统（Agent 控制网页 DOM）

Agent 可通过 `page_command` 工具对当前网页执行结构化命令（需审批），也可由用户直接触发：

| 命令 | 说明 |
| --- | --- |
| `highlight` | 高亮匹配文本（`text`）或元素（`selector`），不改动页面 DOM |
| `clear_highlights` | 清除高亮 / 描边 / 临时样式 |
| `scroll_to` | 滚动到目标文本/元素，或指定 `top`/`left` 坐标 |
| `scroll_by` | 按 `x`/`y` 偏移滚动 |
| `outline` | 用边框描边标注目标元素 |
| `set_style` | 临时修改目标元素样式（可设 `duration` 自动还原） |
| `click` | 点击目标元素 |
| `get_text` | 读取目标元素的文本 |

- **AI 路径**：在对话里说「高亮这段文字 / 跳到那个标题 / 把这个按钮标出来」，Agent 会调用 `page_command`。
- **用户路径 API**：`chrome.runtime.sendMessage({ type: 'pageCommand', command, params })`，后台转发到当前活动标签页。

### 接入 MCP 服务器（扩展 Agent 工具）

Agent 可作为 **MCP 客户端**连接远程 MCP 服务器（Streamable HTTP），自动加载其工具（工具名以 `mcp__` 开头），从而访问文件系统、联网抓取、Notion 等任意外部能力。

- 设置页「MCP 服务器」卡片：填写 `标识`(英文)、`URL`(如 `https://host/mcp`)、可选 `Bearer Token`，保存即可。
- 每次对话 Agent 会按需连接并拉取工具清单（缓存 5 分钟），在工具调用循环里统一调度内置与 MCP 工具。
- **重要**：MV3 跨域限制要求把每个 MCP 服务器的源加入 `manifest.json` 的 `host_permissions`（如 `"https://host/*"`），否则后台无法发起请求。

## 安装方法 (Edge)

1. 打开 Edge，地址栏输入 `edge://extensions/`
2. 打开右上角「开发人员模式」开关
3. 点击「加载解压缩的扩展」
4. 选择本目录 `bookmark-sorter` 文件夹

## 首次配置

1. 点击插件图标 → 弹窗底部「设置」，或右键插件图标 →「选项」
2. 填入 DeepSeek API Key（在 [platform.deepseek.com](https://platform.deepseek.com) 申请）
3. 按需调整模型（默认 `deepseek-chat`）、翻译目标语言、RAG、Agent 工具审批与快捷语句
4. 保存即可使用 AI 功能；**不配置 Key 也不影响**知识库的收录与检索

## 使用

| 场景 | 操作 |
| --- | --- |
| 快速收录 | 打开网页 → 点工具栏图标 → 选类型/星级 → 填标签备注 → 添加 |
| 手动笔记 | 管理页点「新建笔记」 |
| 划词 RecallFlow | 选中网页文字 → 点「RecallFlow」气泡 → 输入任意指令执行 |
| AI 补全 | 在网页输入框打字，停顿后出现灰色补全 → 按 `Tab` 接受 |
| 知识库查询 | 划词后输入问题，开启 RAG 后 AI 结合你的收藏回答；直接问「知识库有什么内容」可查看全部条目 |

## 目录结构

```
bookmark-sorter/
├── manifest.json   # MV3 清单
├── background.js   # Service Worker：DeepSeek 流式调用 + Agent 编排/工具审批
├── content.js      # 划词悬浮 AI 对话 + 页面命令系统（Shadow DOM 隔离样式）
├── mcp.js          # MCP 客户端（Streamable HTTP）
├── tools.js        # Agent 内置工具声明与执行（含 page_command）
├── options.html    # 设置页（API Key/模型/RAG/工具审批/快捷语句/MCP）
├── options.css / options.js
├── popup.html      # 弹窗（快速收录 + 列表）
├── popup.css / popup.js
├── manager.html    # 完整管理页
├── manager.css / manager.js
├── shared.js       # 公共逻辑（存储/类型/标签/星级/迁移）
└── icons/          # 插件与仓库 Logo
```
