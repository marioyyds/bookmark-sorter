// 内容脚本入口（classic 脚本）：
// MV3 内容脚本不支持静态 ES module，这里用动态 import() 加载 lib/ 下的模块。
// 依赖的模块文件已在 manifest 的 web_accessible_resources 中声明。
if (window.__kbAiLoaded) {
} else {
  window.__kbAiLoaded = true;
  (async () => {
    const chat = await import(chrome.runtime.getURL('lib/page/chat.js'));
    const pageText = await import(chrome.runtime.getURL('lib/page/page-text.js'));
    const commands = await import(chrome.runtime.getURL('lib/page/commands.js'));

    // 响应后台的即时页面正文读取请求（Agent 工具 read_current_page）
    // 与页面命令请求（Agent 工具 page_command / 用户路径 API）
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'kbGetPageText') {
        sendResponse({ text: pageText.extractPageText() });
        return true;
      }
      if (msg && msg.type === 'kbPageCommand') {
        sendResponse(commands.executePageCommand(msg.command, msg.params || {}));
        return false;
      }
      return false;
    });

    chat.initAssistant();
  })();
}
