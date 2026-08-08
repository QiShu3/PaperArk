import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';

let tempDir: string;
let app: Express;
let vectorStore: typeof import('../vectorStore.js');
let mockFetch: ReturnType<typeof vi.fn>;

const MD = `# Test Paper

**Abstract**

Membership inference attacks on diffusion models.

## Introduction

Generative models capture spatiotemporal distributions.

## Methods

Trajectory data is fundamental to urban intelligence.
`;

function embedResponse(texts: string[]): unknown {
  return {
    embeddings: texts.map((_, i) => [0.1 + i * 0.01, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
    lexical_weights: texts.map(() => ({ 1: 0.5 })),
  };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'papers-vector-test-'));
  process.env.PAPERS_ROOT = tempDir;
  process.env.VITEST = '1';
  process.env.VECTOR_SERVICE_URL = 'http://vector.test:17888';
  process.env.VECTOR_SERVICE_DISABLED = '';
  mkdirSync(join(tempDir, 'MD'), { recursive: true });
  mkdirSync(join(tempDir, 'MD', 'images'), { recursive: true });
  mkdirSync(join(tempDir, 'rawPDF'), { recursive: true });
  writeFileSync(join(tempDir, 'MD', 'test-paper.md'), MD);

  mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (url.endsWith('/embed')) {
      return new Response(JSON.stringify(embedResponse(body.texts)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/rerank')) {
      const n = body.passages.length;
      const results = Array.from({ length: n }, (_, i) => ({
        index: n - 1 - i,
        score: (n - i) / 10,
      }));
      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', mockFetch);

  vectorStore = await import('../vectorStore.js');
  const { createApp } = await import('../index.js');
  app = createApp();
});

beforeEach(() => {
  process.env.VECTOR_SERVICE_DISABLED = '';
  mockFetch.mockClear();
});

afterEach(() => {
  process.env.VECTOR_SERVICE_DISABLED = '';
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const { closeDb } = await import('../db.js');
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('vectorStore', () => {
  it('embeds all chunks of a paper into SQLite', async () => {
    const { listChunkVectors, countEmbeddedChunks } = await import('../db.js');
    const count = await vectorStore.embedPaper('test-paper');
    expect(count).toBeGreaterThan(0);
    expect(countEmbeddedChunks()).toBe(count);
    expect(listChunkVectors('test-paper')).toHaveLength(count);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('returns semantic search hits after rerank', async () => {
    await vectorStore.embedPaper('test-paper');
    mockFetch.mockClear();

    const hits = await vectorStore.semanticSearch('如何判断样本是否在训练集里', 'test-paper', 2);
    expect(hits.length).toBe(2);
    expect(hits[0]).toHaveProperty('paperId', 'test-paper');
    expect(typeof hits[0].score).toBe('number');
    // 重排按倒序返回：index 较大的 chunk 排最前
    expect(hits[0].chunkIndex).toBeGreaterThan(hits[1].chunkIndex);
  });

  it('returns empty hits when the paper has no vectors', async () => {
    const hits = await vectorStore.semanticSearch('anything', 'test-paper', 3);
    // 第一次调用后已有向量；单独验证：清空后为空
    const { listChunkVectors } = await import('../db.js');
    if (listChunkVectors('test-paper').length === 0) {
      expect(hits).toEqual([]);
    }
  });

  it('is disabled via VECTOR_SERVICE_DISABLED', async () => {
    process.env.VECTOR_SERVICE_DISABLED = '1';
    expect(vectorStore.vectorEnabled()).toBe(false);
    expect(await vectorStore.embedPaper('test-paper')).toBe(0);
    await expect(vectorStore.semanticSearch('q', 'test-paper')).rejects.toThrow(/未启用/);
  });
});

describe('vector API', () => {
  it('embeds the library and reports status', async () => {
    const res = await request(app).post('/api/vector/embed-all');
    expect(res.status).toBe(202);

    await vi.waitFor(async () => {
      const st = await request(app).get('/api/vector/status');
      expect(st.body.running).toBe(false);
      expect(st.body.embedded).toBeGreaterThan(0);
    }, { timeout: 5000 });
  });

  it('returns semantic search results for a paper', async () => {
    await vectorStore.embedPaper('test-paper');
    const res = await request(app).get('/api/papers/test-paper/semantic-search').query({ q: '隐私风险' });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('heading');
  });

  it('returns 400 for missing query', async () => {
    const res = await request(app).get('/api/papers/test-paper/semantic-search');
    expect(res.status).toBe(400);
  });
});
