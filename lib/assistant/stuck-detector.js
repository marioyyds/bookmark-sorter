// Agent 卡死检测：在已有预算限制之外，观察“动作是否产生进展”。

function stableStringify(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
}

export function createStuckDetector(budget = {}) {
  const windowSize = Math.max(3, Number(budget.stuckWindow) || 8);
  const warnThreshold = Math.max(2, Number(budget.stuckWarnThreshold) || 3);
  const stopThreshold = Math.max(warnThreshold + 1, Number(budget.stuckStopThreshold) || 5);
  const history = [];
  let noProgressStreak = 0;

  function observe({ name, args, result, readOnly = false, progress = false }) {
    const fingerprint = String(name || '') + ':' + stableStringify(args || {});
    const mutation = !readOnly;
    const verification = result && result.verification;
    const noProgress = mutation && (
      (result && result.ok === false) ||
      (verification && verification.executed === false) ||
      (verification && verification.verified === false)
    );
    const mutationSucceeded = mutation && !noProgress;

    // 出现可观察进展（新标签页、页面内容/URL 变化、等待匹配成功）或一次成功变更时，
    // 重置重复计数与无进展连击，避免把正常流程误判为卡死。
    if (progress || mutationSucceeded) {
      history.length = 0;
      noProgressStreak = 0;
      history.push({ fingerprint, mutation, noProgress: false, mutationSucceeded, at: Date.now() });
      return {
        level: 'ok',
        repeated: 1,
        noProgressStreak: 0,
        noProgress: false,
        fingerprint,
        message: '',
      };
    }

    // 只统计“最近一次成功变更之后”的重复次数：
    // 只读观察（get_page_snapshot 等）在搜索/翻页流程中多次调用是正常的，
    // 不应把中间穿插了成功动作的观察次数累计为重复。
    let span = history;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].mutationSucceeded) {
        span = history.slice(i + 1);
        break;
      }
    }
    const previousCount = span.filter((item) => item.fingerprint === fingerprint).length;
    history.push({ fingerprint, mutation, noProgress, mutationSucceeded, at: Date.now() });
    while (history.length > windowSize) history.shift();
    if (noProgress) noProgressStreak += 1;
    else if (mutation) noProgressStreak = 0;
    const repeated = previousCount + 1;
    const stop = repeated >= stopThreshold || noProgressStreak >= stopThreshold;
    const warn = !stop && (repeated >= warnThreshold || noProgressStreak >= warnThreshold);
    return {
      level: stop ? 'stop' : warn ? 'warn' : 'ok',
      repeated,
      noProgressStreak,
      noProgress,
      fingerprint,
      message: stop
        ? '检测到连续无进展或重复动作，已触发安全停止。'
        : warn
          ? '动作多次没有产生可观察进展，请重新读取页面或调整策略。'
          : '',
    };
  }

  return {
    observe,
    reset() { history.length = 0; noProgressStreak = 0; },
    getState() { return { history: history.slice(), noProgressStreak }; },
  };
}
