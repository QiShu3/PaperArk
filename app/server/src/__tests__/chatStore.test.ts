import { describe, it, expect, beforeAll, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.pragma('journal_mode = WAL');
testDb.pragma('foreign_keys = ON');

testDb.exec(`
  CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    char_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_call_id TEXT,
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    round_id TEXT,
    paper_id TEXT,
    model TEXT NOT NULL,
    tool_count INTEGER NOT NULL DEFAULT 0,
    message_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success',
    status_code INTEGER,
    error_message TEXT,
    cache_hit_tokens INTEGER,
    cache_miss_tokens INTEGER,
    duration_ms INTEGER,
    tool_results TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

vi.mock('../db.js', () => ({
  default: testDb,
}));

const { loadChat, saveMessages, clearChat, createSession, listSessions, deleteSession, getLogs } = await import('../chatStore.js');

beforeAll(() => {
  testDb.prepare('INSERT OR REPLACE INTO papers (id, title, char_count) VALUES (?, ?, ?)').run(
    'test-paper',
    'Test Paper',
    100,
  );
});

describe('chatStore', () => {
  const paperId = 'test-paper';
  let sessionId: string;

  beforeAll(() => {
    const s = createSession(paperId, 'Test Session');
    sessionId = s.id;
  });

  it('saves and loads messages with tool_calls round-trip', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search_chunks', arguments: '{"query":"attention"}' },
          },
        ],
      },
      {
        role: 'tool',
        content: 'Found 3 results',
        tool_call_id: 'call_1',
        name: 'search_chunks',
      },
      { role: 'assistant', content: 'Based on the results...' },
    ];

    saveMessages(sessionId, paperId, messages);
    const rows = loadChat(sessionId);

    expect(rows).toHaveLength(4);
    expect(rows[0].session_id).toBe(sessionId);
    expect(rows[0].role).toBe('user');
    expect(rows[0].content).toBe('hello');
    expect(rows[1].role).toBe('assistant');
    expect(rows[1].tool_calls).toBe(
      JSON.stringify([
        { id: 'call_1', type: 'function', function: { name: 'search_chunks', arguments: '{"query":"attention"}' } },
      ]),
    );
    expect(rows[2].role).toBe('tool');
    expect(rows[2].tool_call_id).toBe('call_1');
    expect(rows[2].name).toBe('search_chunks');
    expect(rows[3].role).toBe('assistant');
    expect(rows[3].content).toBe('Based on the results...');
  });

  it('replaces all messages on save (transaction)', () => {
    saveMessages(sessionId, paperId, [{ role: 'user', content: 'second session' }]);
    const rows = loadChat(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('second session');
  });

  it('clearChat removes all messages', () => {
    saveMessages(sessionId, paperId, [
      { role: 'user', content: 'msg1' },
      { role: 'assistant', content: 'msg2' },
    ]);
    expect(loadChat(sessionId)).toHaveLength(2);

    clearChat(sessionId);
    expect(loadChat(sessionId)).toHaveLength(0);
  });

  it('listSessions returns sessions for paper', () => {
    const sessions = listSessions(paperId);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions[0].paper_id).toBe(paperId);
  });

  it('createSession creates a new session', () => {
    const s = createSession(paperId, 'New Chat');
    expect(s.id).toBeTruthy();
    expect(s.title).toBe('New Chat');
    expect(s.paper_id).toBe(paperId);

    const sessions = listSessions(paperId);
    expect(sessions.some((x) => x.id === s.id)).toBe(true);
  });

  it('deleteSession removes session and its messages', () => {
    const s = createSession(paperId, 'To Delete');
    saveMessages(s.id, paperId, [{ role: 'user', content: 'delete me' }]);
    expect(loadChat(s.id)).toHaveLength(1);

    deleteSession(s.id);
    expect(loadChat(s.id)).toHaveLength(0);
    expect(listSessions(paperId).some((x) => x.id === s.id)).toBe(false);
  });

  it('getLogs returns chat_logs for session', () => {
    const s = createSession(paperId, 'Log Test');
    const sid = s.id;
    const roundId = crypto.randomUUID();

    testDb.prepare(
      `INSERT INTO chat_logs (session_id, round_id, paper_id, model, tool_count, message_count, status, status_code, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(sid, roundId, paperId, 'deepseek-v4-pro', 2, 5, 'success', 200, 1234);

    const logs = getLogs(sid);
    expect(logs).toHaveLength(1);
    expect(logs[0].round_id).toBe(roundId);
    expect(logs[0].model).toBe('deepseek-v4-pro');
    expect(logs[0].status).toBe('success');
    expect(logs[0].duration_ms).toBe(1234);
  });
});
