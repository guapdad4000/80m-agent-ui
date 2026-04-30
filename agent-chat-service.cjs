const { createServer } = require('http');
const { parse } = require('url');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 5174);
const HERMES_CLI = process.env.HERMES_CLI || '/home/falcon/.local/bin/hermes';
const HERMES_CWD = process.env.HERMES_CWD || '/home/falcon/Apps/code';
const APP_HOME = process.env.EIGHTY_M_CHAT_HOME || path.join(os.homedir(), '.80m-agent-chat');
const APP_DB_PATH = process.env.EIGHTY_M_CHAT_DB || path.join(APP_HOME, 'chat.db');
const HERMES_STATE_DB = process.env.HERMES_STATE_DB || path.join(os.homedir(), '.hermes', 'state.db');
const JOB_RETENTION_MS = 1000 * 60 * 60;
const MAX_JOBS = 500;

fs.mkdirSync(APP_HOME, { recursive: true });
const appDb = new DatabaseSync(APP_DB_PATH);
appDb.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS agent_threads (
    agent_id TEXT PRIMARY KEY,
    title TEXT,
    hermes_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS thread_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    hermes_session_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_thread_messages_agent_created
    ON thread_messages (agent_id, created_at ASC);
  CREATE TABLE IF NOT EXISTS chat_threads (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    title TEXT,
    hermes_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_threads_agent_updated
    ON chat_threads (agent_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    hermes_session_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created
    ON chat_messages (thread_id, created_at ASC);
`);

const hermesDb = fs.existsSync(HERMES_STATE_DB) ? new DatabaseSync(HERMES_STATE_DB, { readonly: true }) : null;

const JOBS = new Map();
const AGENT_CHAINS = new Map();
const SSE_CLIENTS = new Map();

function nowIso() {
  return new Date().toISOString();
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sseSend(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function broadcastEvent(jobId, event) {
  const clients = SSE_CLIENTS.get(jobId);
  if (!clients) return;
  for (const res of clients) {
    try { sseSend(res, event); } catch (_) {}
  }
}

function isHermesSessionId(value) {
  return typeof value === 'string' && /^\d{8}_\d{6}_\w+$/.test(value);
}

function normalizeAgentId(agentId) {
  return String(agentId || 'prawnius').trim().toLowerCase().replace(/\s+/g, '_');
}

function humanizeAgentId(agentId) {
  return normalizeAgentId(agentId).split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function upsertThread(agentId, updates = {}) {
  const key = normalizeAgentId(agentId);
  const current = appDb.prepare('SELECT * FROM agent_threads WHERE agent_id = ?').get(key);
  const createdAt = current?.created_at || nowIso();
  const updatedAt = nowIso();
  const title = updates.title ?? current?.title ?? humanizeAgentId(key);
  const hermesSessionId = updates.hermes_session_id ?? current?.hermes_session_id ?? null;
  appDb.prepare(`
    INSERT INTO agent_threads (agent_id, title, hermes_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      title = excluded.title,
      hermes_session_id = excluded.hermes_session_id,
      updated_at = excluded.updated_at
  `).run(key, title, hermesSessionId, createdAt, updatedAt);
  return appDb.prepare('SELECT * FROM agent_threads WHERE agent_id = ?').get(key);
}

function appendMessage(agentId, role, content, hermesSessionId = null) {
  const key = normalizeAgentId(agentId);
  const createdAt = nowIso();
  appDb.prepare(`
    INSERT INTO thread_messages (agent_id, role, content, hermes_session_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(key, role, String(content || ''), hermesSessionId, createdAt);
  upsertThread(key, { hermes_session_id: hermesSessionId ?? undefined });
}

function getThread(agentId) {
  return appDb.prepare('SELECT * FROM agent_threads WHERE agent_id = ?').get(normalizeAgentId(agentId)) || null;
}

function createChatThread(agentId, title = null) {
  const key = normalizeAgentId(agentId);
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  appDb.prepare(`
    INSERT INTO chat_threads (id, agent_id, title, hermes_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, key, title || 'New conversation', null, createdAt, createdAt);
  return getChatThread(id);
}

function getChatThread(threadId) {
  if (!threadId) return null;
  return appDb.prepare('SELECT * FROM chat_threads WHERE id = ?').get(String(threadId)) || null;
}

function listChatThreads(agentId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  return appDb.prepare(`
    SELECT id, agent_id, title, hermes_session_id, created_at, updated_at
    FROM chat_threads
    WHERE agent_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(normalizeAgentId(agentId), safeLimit);
}

function ensureChatThread(agentId, threadId = null) {
  const key = normalizeAgentId(agentId);
  if (threadId) {
    const existing = getChatThread(threadId);
    if (existing) return existing;
  }
  const latest = appDb.prepare(`
    SELECT id, agent_id, title, hermes_session_id, created_at, updated_at
    FROM chat_threads
    WHERE agent_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(key);
  if (latest) return latest;
  return createChatThread(key, humanizeAgentId(key));
}

function touchChatThread(threadId, updates = {}) {
  const current = getChatThread(threadId);
  if (!current) return null;
  const title = updates.title ?? current.title ?? 'New conversation';
  const hermesSessionId = updates.hermes_session_id ?? current.hermes_session_id ?? null;
  const updatedAt = nowIso();
  appDb.prepare(`
    UPDATE chat_threads
    SET title = ?, hermes_session_id = ?, updated_at = ?
    WHERE id = ?
  `).run(title, hermesSessionId, updatedAt, current.id);
  return getChatThread(current.id);
}

function appendChatMessage(threadId, agentId, role, content, hermesSessionId = null) {
  const thread = ensureChatThread(agentId, threadId);
  const createdAt = nowIso();
  appDb.prepare(`
    INSERT INTO chat_messages (thread_id, agent_id, role, content, hermes_session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(thread.id, normalizeAgentId(agentId), role, String(content || ''), hermesSessionId, createdAt);
  touchChatThread(thread.id, { hermes_session_id: hermesSessionId ?? undefined, title: thread.title });
  return thread;
}

function getChatMessages(threadId, limit = 200) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  return appDb.prepare(`
    SELECT id, thread_id, agent_id, role, content, hermes_session_id, created_at
    FROM chat_messages
    WHERE thread_id = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(String(threadId), safeLimit);
}

function getChatRecentMessages(threadId, limit = 12) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 50));
  return appDb.prepare(`
    SELECT id, thread_id, agent_id, role, content, hermes_session_id, created_at
    FROM chat_messages
    WHERE thread_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(String(threadId), safeLimit).reverse();
}

function getThreadMessages(agentId, limit = 200) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  return appDb.prepare(`
    SELECT id, role, content, hermes_session_id, created_at
    FROM thread_messages
    WHERE agent_id = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(normalizeAgentId(agentId), safeLimit);
}

function listThreads() {
  return appDb.prepare(`
    SELECT agent_id as agentId, title, hermes_session_id as hermesSessionId, updated_at as updatedAt, created_at as createdAt
    FROM agent_threads
    ORDER BY updated_at DESC
  `).all();
}

function getHermesStateSession(sessionId) {
  if (!hermesDb || !isHermesSessionId(sessionId)) return null;
  return hermesDb.prepare(`
    SELECT id, title, started_at, ended_at, message_count, tool_call_count
    FROM sessions
    WHERE id = ?
    LIMIT 1
  `).get(sessionId) || null;
}

function getHermesStateMessages(sessionId, limit = 200) {
  if (!hermesDb || !isHermesSessionId(sessionId)) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  return hermesDb.prepare(`
    SELECT id, role, content, tool_name, timestamp
    FROM messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(sessionId, safeLimit);
}

function hydrateThreadFromHermes(agentId, sessionId, limit = 200) {
  const key = normalizeAgentId(agentId);
  const existing = appDb.prepare('SELECT COUNT(*) as count FROM thread_messages WHERE agent_id = ?').get(key);
  if ((existing?.count || 0) > 0 || !isHermesSessionId(sessionId)) return;
  const hermesMessages = getHermesStateMessages(sessionId, limit).filter(msg => msg && (msg.role === 'user' || msg.role === 'assistant'));
  if (!hermesMessages.length) return;
  const insert = appDb.prepare(`
    INSERT INTO thread_messages (agent_id, role, content, hermes_session_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertMany = appDb.transaction((rows) => {
    for (const row of rows) {
      insert.run(key, row.role, String(row.content || ''), sessionId, new Date(Number(row.timestamp || Date.now() / 1000) * 1000).toISOString());
    }
  });
  insertMany(hermesMessages);
  const stateSession = getHermesStateSession(sessionId);
  upsertThread(key, { title: stateSession?.title || humanizeAgentId(key), hermes_session_id: sessionId });
}

function listHermesSessions() {
  return new Promise((resolve, reject) => {
    const proc = spawn(HERMES_CLI, ['sessions', 'list'], { cwd: HERMES_CWD, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => (stdout += d.toString()));
    proc.stderr.on('data', d => (stderr += d.toString()));
    proc.on('close', code => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `hermes sessions list exited ${code}`));
        return;
      }
      const sessions = [];
      let headerSeen = false;
      for (const line of stdout.split('\n')) {
        if (!headerSeen) {
          if (line.includes('Preview') || (line.includes('─') && line.trim().startsWith('─'))) headerSeen = true;
          continue;
        }
        const trimmed = line.trim();
        if (!trimmed || trimmed === '─' || trimmed.length < 10) continue;
        const tokens = line.includes('│')
          ? line.split('│').map(t => t.trim()).filter(Boolean)
          : line.trim().split(/\s{2,}/).map(t => t.trim()).filter(Boolean);
        if (tokens.length < 3) continue;
        const id = tokens[tokens.length - 1];
        if (!isHermesSessionId(id)) continue;
        const title = tokens[0] || '';
        const preview = tokens.length >= 4 ? tokens[1] : title;
        const lastActive = tokens.length >= 4 ? tokens[tokens.length - 2] : (tokens[1] || '');
        sessions.push({ id, title, preview, lastActive });
      }
      resolve(sessions);
    });
    proc.on('error', reject);
  });
}

function buildAgentAck(agentId, agentProfile = {}) {
  const name = agentProfile.name || humanizeAgentId(agentId);
  const role = agentProfile.role ? `${agentProfile.role}. ` : '';
  const systemPrompt = agentProfile.systemPrompt ? `${agentProfile.systemPrompt} ` : '';
  return `Acknowledge: You are ${name}. ${role}${systemPrompt}Keep responses concise.`;
}

async function createHermesSession(agentId, agentProfile = {}) {
  const ack = buildAgentAck(agentId, agentProfile);
  return new Promise((resolve, reject) => {
    const proc = spawn(HERMES_CLI, ['chat', '-q', ack], { cwd: HERMES_CWD, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => (stdout += d.toString()));
    proc.stderr.on('data', d => (stderr += d.toString()));
    proc.on('close', code => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(stderr.trim() || `hermes chat exited ${code}`));
        return;
      }
      const match = stdout.match(/Session:\s+(\S{20,})/);
      resolve(match ? match[1] : null);
    });
    proc.on('error', reject);
  });
}

async function resolveAgentSession(agentId, agentProfile = {}) {
  const key = normalizeAgentId(agentId);
  const thread = getThread(key);
  if (thread?.hermes_session_id && isHermesSessionId(thread.hermes_session_id)) return thread.hermes_session_id;

  const created = await createHermesSession(key, agentProfile);
  if (created) {
    upsertThread(key, { title: agentProfile.name || humanizeAgentId(key), hermes_session_id: created });
  }
  return created;
}

function getRecentMessages(agentId, threadId = null, limit = 12) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 50));
  const thread = ensureChatThread(agentId, threadId);
  return getChatRecentMessages(thread.id, safeLimit);
}

function isExactTranscriptRecallRequest(message) {
  const text = String(message || '').toLowerCase();
  return [
    'repeat all the last messages i sent you',
    'send me all the messages i sent you',
    'what did i just say',
    'repeat it word for word',
    'repeat my last messages',
    'what have we been talking about',
    'show my last messages',
    'send me my messages',
  ].some(needle => text.includes(needle));
}

function buildTranscriptRecallResponse(agentId, threadId, message) {
  const text = String(message || '').toLowerCase();
  const recent = getRecentMessages(agentId, threadId, 40);
  const userMessages = recent
    .filter(msg => msg.role === 'user')
    .filter(msg => String(msg.content || '').trim() !== String(message || '').trim())
    .slice(-8);
  if (!userMessages.length) {
    return "You haven't sent me any saved messages in this thread yet.";
  }

  if (text.includes('what did i just say') || text.includes('repeat it word for word')) {
    return userMessages[userMessages.length - 1].content;
  }

  if (text.includes('what have we been talking about')) {
    return userMessages.map((msg, idx) => `${idx + 1}. ${msg.content}`).join('\n');
  }

  return userMessages.map(msg => msg.content).join('\n\n');
}

function buildHermesUserMessage(agentId, threadId, userMessage) {
  const recent = getRecentMessages(agentId, threadId, 8).slice(0, -1);
  if (!recent.length) return userMessage;
  const transcript = recent
    .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join('\n');
  return `[APP THREAD CONTEXT]\nUse this recent thread context if the user asks about previous messages. Do not claim memory loss if the answer is in this transcript.\n${transcript}\n[/APP THREAD CONTEXT]\n\nCURRENT USER MESSAGE:\n${userMessage}`;
}

function parseHermesLine(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('┊')) return null;
  const content = trimmed.slice(1).trim();
  if (!content || content.length < 3) return null;
  const cp1 = content.charCodeAt(0);
  const cp2 = content.charCodeAt(1);
  const lastSpaceIdx = content.lastIndexOf(' ');
  const lastPart = content.slice(lastSpaceIdx + 1);
  if (/^\d+\.?\d*s$/.test(lastPart) && lastSpaceIdx > 3) {
    const duration = parseFloat(lastPart);
    const beforeDur = content.slice(0, lastSpaceIdx);
    if (beforeDur.includes('$')) {
      const dollarIdx = beforeDur.lastIndexOf('$');
      const cmdPart = beforeDur.slice(dollarIdx + 1).trim();
      let subtype = 'tool';
      if (cp1 === 55349 && cp2 === 56475) subtype = 'shell';
      else if (cp1 === 55349 && cp2 === 56470) subtype = 'read';
      else if (cp1 === 55349 && cp2 === 56541) subtype = 'search';
      else if (cp1 === 55349 && cp2 === 56471) subtype = 'browser';
      return { type: 'tool', subtype, name: subtype, command: cmdPart, duration };
    }
    let subtype = 'tool';
    if (cp1 === 55349 && cp2 === 56475) subtype = 'shell';
    else if (cp1 === 55349 && cp2 === 56470) subtype = 'read';
    else if (cp1 === 55349 && cp2 === 56477) subtype = 'write';
    else if (cp1 === 55349 && cp2 === 56541) subtype = 'search';
    else if (cp1 === 55349 && cp2 === 56471) subtype = 'browser';
    else if (cp1 === 55349 && cp2 === 56449) subtype = 'think';
    const parts = beforeDur.split(/\s+/);
    const toolName = parts.slice(1).join(' ') || subtype;
    return { type: 'tool', subtype, name: toolName, duration };
  }
  if (content.length > 3 && content.length < 400) {
    if (content.includes('⚠')) return { type: 'status', level: 'warn', text: content };
    if (content.includes('⏱')) return { type: 'info', text: content };
    if (content.includes('🗜')) return { type: 'context', text: content };
    return { type: 'info', text: content };
  }
  return null;
}

function parseResponse(stdout) {
  const lines = stdout.split('\n');

  // ── Strategy 1: Box-based extraction (primary) ──────────────────────────────
  const SKIP = [
    /^⚠️.*API call failed/, /^⏱️.*Elapsed:/, /^🗜️/, /^📋/, /^🔌/, /^🌐/,
    /^Query:/, /^Initializing agent/, /^\s*\[/, /^Go for it\.+/,
    /^I'm (right )?here/, /^\|\s+\|.*Context:/,
    /^\s*─+\s*$/,  // skip separator lines of dashes
  ];
  const isNoise = t => SKIP.some(p => p.test(t));
  const isFooter = t => /^(Session|Duration|Messages):\s+\S/.test(t) || t.startsWith('Resume this session') || t.startsWith('hermes --resume');
  // Hermes box opener: the ⚕ symbol appears somewhere in the line (skin engine may change label)
  const isBoxOpener = t => t.includes('⚕');
  let responseStarted = false;
  let responseEnded = false;
  const responseLines = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const display = trimmed.replace(/\x1b\[[0-9;]*m/g, '');
    if (isFooter(display)) { if (responseStarted) responseEnded = true; continue; }
    if (/^Go for it/.test(display)) { responseLines.length = 0; responseStarted = false; responseEnded = false; continue; }
    if (!responseStarted && isBoxOpener(display)) { responseStarted = true; continue; }
    if (!responseStarted || responseEnded || isNoise(display)) continue;
    // Skip pure box-char / separator lines
    const nonSpace = display.replace(/\s/g, '');
    const boxChars = (nonSpace.match(/[─│┌┐└┘├┤┬┴┼]/g) || []).length;
    if (boxChars > 0 && boxChars >= nonSpace.length * 0.6) continue;
    responseLines.push(trimmed);
  }

  // If box method got text, return it
  if (responseLines.join('').trim()) return responseLines.join(' ').trim();

  // ── Strategy 2: Extract everything between Query: and Session: ──────────────
  let inQuery = false;
  const queryLines = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const display = trimmed.replace(/\x1b\[[0-9;]*m/g, '');
    if (/^Query:/.test(display)) { inQuery = true; continue; }
    if (/^Session:/.test(display) || /^Duration:/.test(display)) { inQuery = false; break; }
    if (/^Resume this session/.test(display)) { inQuery = false; break; }
    if (!inQuery) continue;
    if (isNoise(display)) continue;
    // Skip the " ─  ⚕ Hermes  ─..." separator line
    const nonSpace = display.replace(/\s/g, '');
    const boxChars = (nonSpace.match(/[─│┌┐└┘├┤┬┴┼]/g) || []).length;
    if (boxChars > 0 && boxChars >= nonSpace.length * 0.5) continue;
    queryLines.push(trimmed);
  }
  if (queryLines.join('').trim()) return queryLines.join(' ').trim();

  // ── Strategy 3: Last resort — grab all non-noise text after Query: ─────────
  const afterQuery = [];
  let seenQuery = false;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const display = trimmed.replace(/\x1b\[[0-9;]*m/g, '');
    if (/^Query:/.test(display)) { seenQuery = true; continue; }
    if (/^(Session|Duration):/.test(display) || /^Resume this/.test(display)) break;
    if (!seenQuery) continue;
    if (isNoise(display)) continue;
    const nonSpace = display.replace(/\s/g, '');
    const boxChars = (nonSpace.match(/[─│┌┐└┘├┤┬┴┼]/g) || []).length;
    if (boxChars > 0 && boxChars >= nonSpace.length * 0.4) continue;
    afterQuery.push(trimmed);
  }
  return afterQuery.join(' ').trim() || 'No response extracted';
}

function execHermesWithStream(jobId, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(HERMES_CLI, args, { cwd: HERMES_CWD, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    const events = [];
    proc.stdout.on('data', d => {
      const chunk = d.toString();
      stdout += chunk;
      for (const raw of chunk.split('\n')) {
        if (!raw.trim()) continue;
        const event = parseHermesLine(raw);
        if (event) {
          events.push(event);
          broadcastEvent(jobId, event);
        }
      }
    });
    proc.stderr.on('data', d => {
      const chunk = d.toString();
      stderr += chunk;
      if (chunk.includes('Error') || chunk.includes('WARN')) {
        broadcastEvent(jobId, { type: 'stderr', text: chunk.trim().slice(0, 200) });
      }
    });
    proc.on('close', code => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Hermes exited ${code}`));
        return;
      }
      resolve({ response: parseResponse(stdout), events });
    });
    proc.on('error', reject);
  });
}

function createJob({ agent_id, thread_id, message, session_id, provider, agent_profile }) {
  const id = crypto.randomUUID();
  const job = {
    id,
    agent_id: normalizeAgentId(agent_id),
    thread_id: thread_id || null,
    message,
    provider: provider || 'hermes',
    session_id: isHermesSessionId(session_id) ? session_id : null,
    agent_profile: agent_profile || {},
    status: 'queued',
    created_at: nowIso(),
    started_at: null,
    completed_at: null,
    duration_ms: null,
    response: null,
    error: null,
    events: [],
  };
  JOBS.set(id, job);
  return job;
}

async function runJob(job) {
  job.status = 'running';
  job.started_at = nowIso();
  const start = Date.now();
  broadcastEvent(job.id, { type: 'started', agent_id: job.agent_id, thread_id: job.thread_id || null, message: job.message, session_id: job.session_id || null });
  try {
    const activeThread = ensureChatThread(job.agent_id, job.thread_id);
    job.thread_id = activeThread.id;
    job.session_id = job.session_id || activeThread.hermes_session_id || await resolveAgentSession(job.agent_id, job.agent_profile);
    if (job.session_id) {
      touchChatThread(job.thread_id, { title: activeThread.title || job.agent_profile?.name || humanizeAgentId(job.agent_id), hermes_session_id: job.session_id });
      upsertThread(job.agent_id, { title: job.agent_profile?.name || humanizeAgentId(job.agent_id), hermes_session_id: job.session_id });
      broadcastEvent(job.id, { type: 'session', agent_id: job.agent_id, thread_id: job.thread_id, session_id: job.session_id });
    }
    const args = ['chat', '-q', buildHermesUserMessage(job.agent_id, job.thread_id, job.message)];
    if (job.session_id) args.push('--resume', job.session_id);
    const { response, events } = await execHermesWithStream(job.id, args);
    job.response = response;
    job.events = events;
    job.status = 'completed';
    job.completed_at = nowIso();
    job.duration_ms = Date.now() - start;
    appendChatMessage(job.thread_id, job.agent_id, 'assistant', response, job.session_id);
    appendMessage(job.agent_id, 'assistant', response, job.session_id);
    broadcastEvent(job.id, { type: 'done', response, events, duration_ms: job.duration_ms, thread_id: job.thread_id, session_id: job.session_id || null });
    broadcastEvent(job.id, { type: 'ended', thread_id: job.thread_id, session_id: job.session_id || null });
  } catch (err) {
    job.status = 'failed';
    job.error = err?.message || String(err);
    job.completed_at = nowIso();
    job.duration_ms = Date.now() - start;
    broadcastEvent(job.id, { type: 'error', error: job.error, thread_id: job.thread_id, session_id: job.session_id || null });
    broadcastEvent(job.id, { type: 'ended', thread_id: job.thread_id, session_id: job.session_id || null });
  }
}

function enqueueJob(job) {
  const key = job.agent_id || '__default__';
  const prev = AGENT_CHAINS.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => runJob(job));
  AGENT_CHAINS.set(key, next);
}

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of JOBS.entries()) {
    const ended = job.completed_at ? Date.parse(job.completed_at) : null;
    if (ended && now - ended > JOB_RETENTION_MS) {
      JOBS.delete(id);
      SSE_CLIENTS.delete(id);
    }
  }
  if (JOBS.size > MAX_JOBS) {
    const sorted = [...JOBS.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    for (let i = 0; i < JOBS.size - MAX_JOBS; i++) {
      JOBS.delete(sorted[i].id);
      SSE_CLIENTS.delete(sorted[i].id);
    }
  }
}
setInterval(cleanupJobs, 60_000);

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Pragma, Last-Event-ID, X-Requested-With');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const { pathname, query } = parse(req.url, true);

  if (pathname === '/health' && req.method === 'GET') {
    return json(res, 200, { status: 'ok', mode: '80m-standalone', db_path: APP_DB_PATH, jobs: JOBS.size });
  }

  if (pathname === '/sessions' && req.method === 'GET') {
    const sessions = listThreads().map(thread => ({
      id: thread.hermesSessionId || thread.agentId,
      title: thread.title,
      preview: thread.title,
      lastActive: thread.updatedAt,
      agentId: thread.agentId,
      hermes_session_id: thread.hermesSessionId,
    }));
    return json(res, 200, { sessions });
  }

  if (pathname === '/threads' && req.method === 'GET') {
    const agentId = normalizeAgentId(query?.agent_id || query?.agentId || 'prawnius');
    const threads = listChatThreads(agentId).map(thread => ({
      id: thread.id,
      agent_id: thread.agent_id,
      title: thread.title,
      session_id: thread.hermes_session_id,
      updated_at: thread.updated_at,
      created_at: thread.created_at,
    }));
    return json(res, 200, { agent_id: agentId, threads });
  }

  if (pathname === '/threads' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const agentId = normalizeAgentId(parsed.agent_id || parsed.agentId || 'prawnius');
        const title = parsed.title || humanizeAgentId(agentId);
        const thread = createChatThread(agentId, title);
        return json(res, 201, {
          thread: {
            id: thread.id,
            agent_id: thread.agent_id,
            title: thread.title,
            session_id: thread.hermes_session_id,
            updated_at: thread.updated_at,
            created_at: thread.created_at,
          }
        });
      } catch (err) {
        return json(res, 500, { error: err?.message || String(err) });
      }
    });
    return;
  }

  if (pathname === '/threads/select' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const thread = ensureChatThread(parsed.agent_id || 'prawnius', parsed.thread_id || null);
        return json(res, 200, { thread });
      } catch (err) {
        return json(res, 500, { error: err?.message || String(err) });
      }
    });
    return;
  }

  if (pathname === '/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const agentId = parsed.agent_id || parsed.agentId || 'prawnius';
        const message = String(parsed.message || '').trim();
        if (!message) return json(res, 400, { error: 'message required' });
        const normalizedAgentId = normalizeAgentId(agentId);
        const agentProfile = parsed.agent_profile || {};
        const thread = ensureChatThread(normalizedAgentId, parsed.thread_id || null);

        appendChatMessage(thread.id, normalizedAgentId, 'user', message, parsed.session_id || thread.hermes_session_id || null);
        appendMessage(normalizedAgentId, 'user', message, parsed.session_id || thread.hermes_session_id || null);
        upsertThread(normalizedAgentId, { title: agentProfile?.name || humanizeAgentId(normalizedAgentId), hermes_session_id: parsed.session_id || thread.hermes_session_id || undefined });

        if (isExactTranscriptRecallRequest(message)) {
          const response = buildTranscriptRecallResponse(normalizedAgentId, thread.id, message);
          appendChatMessage(thread.id, normalizedAgentId, 'assistant', response, parsed.session_id || thread.hermes_session_id || null);
          appendMessage(normalizedAgentId, 'assistant', response, parsed.session_id || thread.hermes_session_id || null);
          return json(res, 200, {
            accepted: true,
            status: 'completed',
            agent_id: normalizedAgentId,
            thread_id: thread.id,
            session_id: parsed.session_id || thread.hermes_session_id || null,
            response,
            events: [],
            source: 'app-transcript',
          });
        }

        const job = createJob({
          agent_id: normalizedAgentId,
          thread_id: thread.id,
          message,
          session_id: parsed.session_id || thread.hermes_session_id || null,
          provider: parsed.provider,
          agent_profile: agentProfile,
        });
        enqueueJob(job);
        return json(res, 202, {
          accepted: true,
          job_id: job.id,
          status: job.status,
          agent_id: job.agent_id,
          thread_id: thread.id,
          session_id: job.session_id || null,
          created_at: job.created_at,
        });
      } catch (err) {
        return json(res, 500, { error: err?.message || String(err) });
      }
    });
    return;
  }

  const statusMatch = pathname?.match(/^\/chat\/status\/(.+)$/);
  if (statusMatch && req.method === 'GET') {
    const job = JOBS.get(statusMatch[1]);
    if (!job) return json(res, 404, { error: 'job not found' });
    return json(res, 200, {
      job_id: job.id,
      status: job.status,
      agent_id: job.agent_id,
      thread_id: job.thread_id || null,
      session_id: job.session_id,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      duration_ms: job.duration_ms,
      response: job.status === 'completed' ? job.response : undefined,
      error: job.status === 'failed' ? job.error : undefined,
      events: job.status === 'completed' ? job.events : undefined,
    });
  }

  const streamMatch = pathname?.match(/^\/chat\/stream\/(.+)$/);
  const queryJobId = pathname === '/chat/stream' ? query?.job_id : null;
  if ((streamMatch || queryJobId) && req.method === 'GET') {
    const jobId = streamMatch ? streamMatch[1] : String(queryJobId || '');
    const job = JOBS.get(jobId);
    if (!job) return json(res, 404, { error: 'job not found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    sseSend(res, { type: 'init', job_id: job.id, status: job.status, thread_id: job.thread_id || null, session_id: job.session_id || null });
    if (!SSE_CLIENTS.has(jobId)) SSE_CLIENTS.set(jobId, new Set());
    SSE_CLIENTS.get(jobId).add(res);
    req.on('close', () => { SSE_CLIENTS.get(jobId)?.delete(res); });
    return;
  }

  const agentContextMatch = pathname?.match(/^\/agent-context\/([a-zA-Z0-9_\-]+)$/);
  if (agentContextMatch && req.method === 'GET') {
    const agentId = normalizeAgentId(agentContextMatch[1]);
    const limit = Math.min(parseInt(query?.limit || '120', 10) || 120, 500);
    const thread = ensureChatThread(agentId, query?.thread_id || null);
    if (thread?.hermes_session_id) hydrateThreadFromHermes(agentId, thread.hermes_session_id, limit);
    const refreshedThread = getChatThread(thread.id);
    const messages = getChatMessages(thread.id, limit).map(msg => ({
      id: msg.id,
      thread_id: msg.thread_id,
      role: msg.role,
      content: msg.content,
      hermes_session_id: msg.hermes_session_id,
      timestamp: Date.parse(msg.created_at) / 1000,
    }));
    return json(res, 200, {
      agent_id: agentId,
      thread_id: refreshedThread?.id || thread.id,
      session_id: refreshedThread?.hermes_session_id || null,
      session: refreshedThread,
      messages,
      threads: listChatThreads(agentId),
    });
  }

  const historyMatch = pathname?.match(/^\/chat\/history\/([^/]+)$/);
  if (historyMatch && req.method === 'GET') {
    const sessionId = String(historyMatch[1] || '');
    const limit = Math.min(parseInt(query?.limit || '200', 10) || 200, 500);
    return json(res, 200, {
      session_id: sessionId,
      session: getHermesStateSession(sessionId),
      messages: getHermesStateMessages(sessionId, limit),
    });
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`80M standalone agent chat service running on 0.0.0.0:${PORT}`);
  console.log(`App DB: ${APP_DB_PATH}`);
});
