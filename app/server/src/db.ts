import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH } from './paths.js';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    char_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    parent_id INTEGER REFERENCES chunks(id),
    heading TEXT NOT NULL,
    heading_level INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    char_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    heading,
    content,
    content='chunks',
    content_rowid='id'
  );

  CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, heading, content) VALUES (new.id, new.heading, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, heading, content) VALUES('delete', old.id, old.heading, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, heading, content) VALUES('delete', old.id, old.heading, old.content);
    INSERT INTO chunks_fts(rowid, heading, content) VALUES (new.id, new.heading, new.content);
  END;

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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrations: add columns if they don't exist (idempotent)
for (const col of ['session_id', 'tool_calls', 'tool_call_id', 'name']) {
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN ${col} TEXT`);
  } catch {
    // column already exists, skip
  }
}

for (const col of ['session_id', 'round_id']) {
  try {
    db.exec(`ALTER TABLE chat_logs ADD COLUMN ${col} TEXT`);
  } catch {
    // column already exists, skip
  }
}

for (const col of ['tool_results']) {
  try {
    db.exec(`ALTER TABLE chat_logs ADD COLUMN ${col} TEXT`);
  } catch {
    // column already exists, skip
  }
}

// 向量检索：chunks 增加 embedding（fp32 BLOB）与 lexical（稀疏权重 JSON）
try {
  db.exec('ALTER TABLE chunks ADD COLUMN embedding BLOB');
} catch {
  // column already exists, skip
}
try {
  db.exec('ALTER TABLE chunks ADD COLUMN lexical TEXT');
} catch {
  // column already exists, skip
}

// Migration: fix CHECK constraint to include 'tool' role
try {
  const info = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_messages'",
  ).get() as { sql: string } | undefined;
  if (info && !info.sql.includes("'tool'")) {
    db.exec(`
      CREATE TABLE chat_messages_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO chat_messages_new SELECT id, session_id, paper_id, role, content, tool_calls, tool_call_id, name, created_at FROM chat_messages;
      DROP TABLE chat_messages;
      ALTER TABLE chat_messages_new RENAME TO chat_messages;
    `);
  }
} catch {
  // migration already applied or not needed
}

export function insertPaper(id: string, title: string, charCount: number): void {
  db.prepare(
    'INSERT INTO papers (id, title, char_count) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, char_count = excluded.char_count'
  ).run(id, title, charCount);
}

export function clearPaper(id: string): void {
  db.prepare('DELETE FROM papers WHERE id = ?').run(id);
}

export function insertChunk(
  paperId: string,
  chunkIndex: number,
  parentId: number | null,
  heading: string,
  headingLevel: number,
  content: string,
  charCount: number
): number {
  const result = db.prepare(
    'INSERT INTO chunks (paper_id, chunk_index, parent_id, heading, heading_level, content, char_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(paperId, chunkIndex, parentId, heading, headingLevel, content, charCount);
  return Number(result.lastInsertRowid);
}

export function getStats(): { papers: number; chunks: number } {
  const p = db.prepare('SELECT COUNT(*) AS cnt FROM papers').get() as { cnt: number };
  const c = db.prepare('SELECT COUNT(*) AS cnt FROM chunks').get() as { cnt: number };
  return { papers: p.cnt, chunks: c.cnt };
}

export function clearChunks(paperId: string): void {
  db.prepare('DELETE FROM chunks WHERE paper_id = ?').run(paperId);
}

export function saveChunks(
  paperId: string,
  chunks: { heading: string; heading_level: number; content: string; char_count: number }[],
): void {
  const del = db.prepare('DELETE FROM chunks WHERE paper_id = ?');
  const insert = db.prepare(
    'INSERT INTO chunks (paper_id, chunk_index, parent_id, heading, heading_level, content, char_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    del.run(paperId);
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      insert.run(paperId, i, null, c.heading, c.heading_level, c.content, c.char_count);
    }
  })();
}

export function chunkCount(paperId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS cnt FROM chunks WHERE paper_id = ?').get(paperId) as { cnt: number };
  return row.cnt;
}

export interface ChunkForEmbedding {
  id: number;
  paper_id: string;
  chunk_index: number;
  heading: string;
  content: string;
}

export function listChunksForEmbedding(paperId?: string): ChunkForEmbedding[] {
  if (paperId) {
    return db
      .prepare(
        `SELECT id, paper_id, chunk_index, heading, content FROM chunks WHERE paper_id = ? ORDER BY chunk_index`,
      )
      .all(paperId) as ChunkForEmbedding[];
  }
  return db
    .prepare(`SELECT id, paper_id, chunk_index, heading, content FROM chunks ORDER BY paper_id, chunk_index`)
    .all() as ChunkForEmbedding[];
}

export function updateChunkVector(id: number, embedding: Buffer, lexical: string | null): void {
  db.prepare('UPDATE chunks SET embedding = ?, lexical = ? WHERE id = ?').run(embedding, lexical, id);
}

export function countEmbeddedChunks(): number {
  const row = db
    .prepare('SELECT COUNT(*) AS cnt FROM chunks WHERE embedding IS NOT NULL')
    .get() as { cnt: number };
  return row.cnt;
}

export function listChunkVectors(paperId?: string): {
  id: number;
  paper_id: string;
  heading: string;
  content: string;
  chunk_index: number;
  embedding: Buffer;
}[] {
  const rows = paperId
    ? (db
        .prepare(
          `SELECT id, paper_id, chunk_index, heading, content, embedding FROM chunks WHERE paper_id = ? AND embedding IS NOT NULL ORDER BY chunk_index`,
        )
        .all(paperId) as {
        id: number;
        paper_id: string;
        heading: string;
        content: string;
        chunk_index: number;
        embedding: Buffer;
      }[])
    : (db
        .prepare(
          `SELECT id, paper_id, chunk_index, heading, content, embedding FROM chunks WHERE embedding IS NOT NULL`,
        )
        .all() as {
        id: number;
        paper_id: string;
        heading: string;
        content: string;
        chunk_index: number;
        embedding: Buffer;
      }[]);
  return rows;
}

export function closeDb(): void {
  if (db.open) db.close();
}

export default db;
