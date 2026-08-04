import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';

let app: Express;
let tempDir: string;

let mockFetch = vi.fn();

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'papers-api-test-'));
  process.env.PAPERS_ROOT = tempDir;
  process.env.VITEST = '1';

  mkdirSync(join(tempDir, 'MD'), { recursive: true });
  mkdirSync(join(tempDir, 'MD', 'images'), { recursive: true });
  mkdirSync(join(tempDir, 'rawPDF'), { recursive: true });

  const mdContent = `# Test Paper\n\n**Abstract**\n\nTest abstract.\n\n## Introduction\n\nIntro text with image ![](images/test.png).\n\n## Methods\n\nMethods content here.`;
  writeFileSync(join(tempDir, 'MD', 'test-paper.md'), mdContent);

  vi.stubGlobal('fetch', mockFetch);

  const { createApp } = await import('../index.js');
  app = createApp();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const { closeDb } = await import('../db.js');
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('POST /api/chat', () => {
  it('returns 400 when apiKey is missing', async () => {
    const res = await request(app).post('/api/chat').send({
      model: 'v4-pro',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('API Key');
  });

  it('streams content delta via SSE', async () => {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n\n' +
              'data: {"id":"1","choices":[{"delta":{"content":" world"}}]}\n\n' +
              'data: {"id":"1","choices":[],"usage":{"prompt_cache_hit_tokens":10,"prompt_cache_miss_tokens":5}}\n\n' +
              'data: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: streamBody,
    });

    const res = await request(app)
      .post('/api/chat')
      .send({
        model: 'v4-pro',
        messages: [{ role: 'user', content: 'hello' }],
        apiKey: 'test-key',
      })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const body = res.text;
    expect(body).toContain('"content":"Hello"');
    expect(body).toContain('"content":" world"');
    expect(body).toContain('"usage"');
    expect(body).toContain('[DONE]');
  });

  it('streams tool_calls delta', async () => {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      start(controller) {
        const chunk =
          'data: {"id":"1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_chunks","arguments":"{\\"query\\":\\"test\\"}"}}]}}]}\n\n' +
          'data: [DONE]\n\n';
        controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: streamBody,
    });

    const res = await request(app)
      .post('/api/chat')
      .send({
        model: 'v4-pro',
        messages: [{ role: 'user', content: 'search test' }],
        apiKey: 'test-key',
        tools: [{ type: 'function', function: { name: 'search_chunks', parameters: {} } }],
      })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.text).toContain('"tool_calls"');
    expect(res.text).toContain('search_chunks');
  });

  it('forwards tools in request body to DeepSeek', async () => {
    mockFetch.mockClear();

    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"id":"1","choices":[{"delta":{"content":"ok"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: streamBody,
    });

    const testTools = [{ type: 'function', function: { name: 'list_chunks', parameters: {} } }];

    await request(app)
      .post('/api/chat')
      .send({
        model: 'v4-flash',
        messages: [{ role: 'user', content: 'list' }],
        apiKey: 'test-key',
        tools: testTools,
      })
      .buffer(true);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchUrl = mockFetch.mock.calls[0][0];
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(fetchBody.tools).toEqual(testTools);
    expect(fetchBody.model).toBe('deepseek-v4-flash');
    expect(fetchBody.stream).toBe(true);
  });

  it('handles content and tool_calls in same chunk', async () => {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      start(controller) {
        const chunk =
          'data: {"id":"1","choices":[{"delta":{"content":"Let me search","tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"get_chunk","arguments":"{}"}}]}}]}\n\n' +
          'data: [DONE]\n\n';
        controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: streamBody,
    });

    const res = await request(app)
      .post('/api/chat')
      .send({
        model: 'v4-pro',
        messages: [{ role: 'user', content: 'search' }],
        apiKey: 'test-key',
      })
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.text).toContain('"content"');
    expect(res.text).toContain('"tool_calls"');
  });

  it('returns 401 when DeepSeek returns error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid api key"}',
    });

    const res = await request(app).post('/api/chat').send({
      model: 'v4-pro',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'bad-key',
    });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/papers/:id/images', () => {
  it('returns image paths from markdown', async () => {
    const res = await request(app).get('/api/papers/test-paper/images');
    expect(res.status).toBe(200);
    expect(res.body.images).toContain('images/test.png');
  });

  it('returns 404 for non-existent paper', async () => {
    const res = await request(app).get('/api/papers/non-existent/images');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/papers/:id/chunks?q=', () => {
  it('returns empty when no chunks exist', async () => {
    const res = await request(app).get('/api/papers/test-paper/chunks?q=nonexistent');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
