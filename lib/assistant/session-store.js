// Agent Session 持久化：优先使用 MV3 的 chrome.storage.session。
// 该区域不会同步到云端，适合保存恢复 Agent 所需的临时上下文。

const SESSION_KEY = 'recallflow.agentSessions.v1';
const MAX_SESSIONS = 8;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function storageArea() {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage.session || chrome.storage.local;
}

async function readSessions() {
  const area = storageArea();
  if (!area) return {};
  const data = await area.get(SESSION_KEY);
  const sessions = data && data[SESSION_KEY];
  return sessions && typeof sessions === 'object' ? sessions : {};
}

async function writeSessions(sessions) {
  const area = storageArea();
  if (!area) return;
  await area.set({ [SESSION_KEY]: sessions });
}

function prune(sessions, now = Date.now()) {
  const entries = Object.entries(sessions)
    .filter(([, session]) => session && now - Number(session.updatedAt || session.createdAt || 0) < SESSION_TTL_MS)
    .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0))
    .slice(0, MAX_SESSIONS);
  return Object.fromEntries(entries);
}

export async function saveAgentSession(session) {
  if (!session || !session.id) return;
  const sessions = prune(await readSessions());
  sessions[session.id] = {
    ...session,
    updatedAt: Date.now(),
  };
  await writeSessions(prune(sessions));
}

export async function loadAgentSession(id) {
  if (!id) return null;
  const sessions = prune(await readSessions());
  const session = sessions[id];
  // 清理过期记录，同时避免每次读取都把旧任务继续保留。
  await writeSessions(sessions);
  return session || null;
}

export async function removeAgentSession(id) {
  if (!id) return;
  const sessions = await readSessions();
  if (!sessions[id]) return;
  delete sessions[id];
  await writeSessions(sessions);
}

export async function listAgentSessions() {
  const sessions = prune(await readSessions());
  await writeSessions(sessions);
  return Object.values(sessions);
}

export { SESSION_KEY };
