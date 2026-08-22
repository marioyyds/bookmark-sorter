// DeepSeek（OpenAI 兼容）调用：一次性请求 + 指数退避重试

async function callDeepSeekOnce(settings, messages) {
  const url = settings.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!resp.ok) {
    let detail = '';
    try {
      const j = await resp.json();
      detail = j.error && j.error.message ? j.error.message : JSON.stringify(j);
    } catch (e) {
      detail = await resp.text();
    }
    const err = new Error('DeepSeek 请求失败 (' + resp.status + '): ' + detail);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message.content;
  if (!content) throw new Error('DeepSeek 返回为空');
  return content.trim();
}

/** 判断错误是否可重试：网络错误（无 status）或服务端 5xx / 429 限流 */
export function isRetryableError(e) {
  if (!e || !e.status) return true;
  return e.status === 429 || e.status >= 500;
}

/** 带指数退避重试的 DeepSeek 调用（最多 3 次尝试，间隔 0.5s/1s） */
export async function callDeepSeek(settings, messages) {
  const MAX_RETRIES = 2;
  for (let attempt = 0; ; attempt++) {
    try {
      return await callDeepSeekOnce(settings, messages);
    } catch (e) {
      if (attempt >= MAX_RETRIES || !isRetryableError(e)) throw e;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
}
