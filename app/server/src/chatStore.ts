import db from './db.js';

export interface ChatMessageRow {
  id: number;
  session_id: string;
  paper_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  name: string | null;
  created_at: string;
}

export interface ChatSessionRow {
  id: string;
  paper_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

const loadStmt = db.prepare(
  'SELECT id, session_id, paper_id, role, content, tool_calls, tool_call_id, name, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC',
);

const appendStmt = db.prepare(
  'INSERT INTO chat_messages (session_id, paper_id, role, content, tool_calls, tool_call_id, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
);

const clearStmt = db.prepare('DELETE FROM chat_messages WHERE session_id = ?');

const deleteByPaperStmt = db.prepare('DELETE FROM chat_messages WHERE paper_id = ?');

const deleteBySessionStmt = db.prepare('DELETE FROM chat_messages WHERE session_id = ?');

const createSessionStmt = db.prepare(
  'INSERT INTO chat_sessions (id, paper_id, title) VALUES (?, ?, ?)',
);

const updateSessionTitleStmt = db.prepare(
  'UPDATE chat_sessions SET title = ?, updated_at = datetime(\'now\') WHERE id = ?',
);

const touchSessionStmt = db.prepare(
  'UPDATE chat_sessions SET updated_at = datetime(\'now\') WHERE id = ?',
);

const listSessionsStmt = db.prepare(
  'SELECT id, paper_id, title, created_at, updated_at FROM chat_sessions WHERE paper_id = ? ORDER BY updated_at DESC',
);

const deleteSessionStmt = db.prepare('DELETE FROM chat_sessions WHERE id = ?');

const getLatestSessionStmt = db.prepare(
  'SELECT id, paper_id, title, created_at, updated_at FROM chat_sessions WHERE paper_id = ? ORDER BY updated_at DESC LIMIT 1',
);

const countSessionsStmt = db.prepare(
  'SELECT COUNT(*) AS cnt FROM chat_sessions WHERE paper_id = ?',
);

export function loadChat(sessionId: string): ChatMessageRow[] {
  return loadStmt.all(sessionId) as ChatMessageRow[];
}

export interface SaveMessage {
  role: string;
  content: string | null;
  tool_calls?: Record<string, unknown>[];
  tool_call_id?: string;
  name?: string;
}

export function saveMessages(sessionId: string, paperId: string, messages: SaveMessage[]): void {
  const replace = db.transaction(() => {
    clearStmt.run(sessionId);
    for (const msg of messages) {
      appendStmt.run(
        sessionId,
        paperId,
        msg.role,
        msg.content ?? '',
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        msg.tool_call_id ?? null,
        msg.name ?? null,
      );
    }
    touchSessionStmt.run(sessionId);
  });
  replace();
}

export function clearChat(sessionId: string): void {
  clearStmt.run(sessionId);
}

export function deleteByPaper(paperId: string): void {
  deleteByPaperStmt.run(paperId);
}

export function createSession(paperId: string, title?: string): ChatSessionRow {
  const id = crypto.randomUUID();
  const cnt = (countSessionsStmt.get(paperId) as { cnt: number }).cnt;
  const finalTitle = title && title.trim() ? title.trim() : `会话 ${cnt + 1}`;
  createSessionStmt.run(id, paperId, finalTitle);
  return { id, paper_id: paperId, title: finalTitle, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

export function updateSessionTitle(sessionId: string, title: string): void {
  updateSessionTitleStmt.run(title, sessionId);
}

export function listSessions(paperId: string): ChatSessionRow[] {
  return listSessionsStmt.all(paperId) as ChatSessionRow[];
}

export function deleteSession(sessionId: string): void {
  const del = db.transaction(() => {
    deleteBySessionStmt.run(sessionId);
    deleteSessionStmt.run(sessionId);
  });
  del();
}

export function getLatestSession(paperId: string): ChatSessionRow | undefined {
  return getLatestSessionStmt.get(paperId) as ChatSessionRow | undefined;
}

export interface ChatLogRow {
  id: number;
  session_id: string | null;
  round_id: string | null;
  paper_id: string | null;
  model: string;
  tool_count: number;
  message_count: number;
  status: string;
  status_code: number | null;
  error_message: string | null;
  cache_hit_tokens: number | null;
  cache_miss_tokens: number | null;
  duration_ms: number | null;
  created_at: string;
  tool_results: string | null;
}

const getLogsStmt = db.prepare(
  'SELECT id, session_id, round_id, paper_id, model, tool_count, message_count, status, status_code, error_message, cache_hit_tokens, cache_miss_tokens, duration_ms, created_at, tool_results FROM chat_logs WHERE session_id = ? ORDER BY id ASC',
);

const getLogByRoundStmt = db.prepare(
  'SELECT id FROM chat_logs WHERE round_id = ? ORDER BY id DESC LIMIT 1',
);

const appendToolResultsStmt = db.prepare(
  `UPDATE chat_logs SET tool_results = ? WHERE id = ?`,
);

export function getLogs(sessionId: string): ChatLogRow[] {
  return getLogsStmt.all(sessionId) as ChatLogRow[];
}

export function appendToolResults(roundId: string, results: { name: string; success: boolean; error?: string }[]): boolean {
  const row = getLogByRoundStmt.get(roundId) as { id: number } | undefined;
  if (!row) return false;

  const existingJson = db.prepare('SELECT tool_results FROM chat_logs WHERE id = ?').get(row.id) as { tool_results: string | null } | undefined;
  const existing: { name: string; success: boolean; error?: string }[] = existingJson?.tool_results
    ? (() => { try { return JSON.parse(existingJson.tool_results); } catch { return []; } })()
    : [];

  const merged = [...existing, ...results];
  appendToolResultsStmt.run(JSON.stringify(merged), row.id);
  return true;
}
