import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';

let app: Express;
let tempDir: string;
let mockFetch: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'papers-e2e-'));
  process.env.PAPERS_ROOT = tempDir;
  process.env.VITEST = '1';

  mkdirSync(join(tempDir, 'MD'), { recursive: true });
  mkdirSync(join(tempDir, 'MD', 'images'), { recursive: true });
  mkdirSync(join(tempDir, 'rawPDF'), { recursive: true });

  const mdContent = `# Test Paper\n\n**Abstract**\n\nTest abstract.\n\n## Introduction\n\nText with ![](images/test.png).\n\n## Methods\n\nMethods content here.`;
  writeFileSync(join(tempDir, 'MD', 'test-paper.md'), mdContent);

  const { createApp } = await import('../index.js');
  app = createApp();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const { closeDb } = await import('../db.js');
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

describe('Chat API E2E — Tool Calling', () => {
  it('full-round streams tool_calls from model', async () => {
    const chunk = JSON.stringify({
      id: 'resp-1',
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_abc123',
                type: 'function',
                function: { name: 'search_chunks', arguments: '{"query":"attention"}' },
              },
            ],
          },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(c: ReadableStreamDefaultController) {
          c.enqueue(new TextEncoder().encode(`data: ${chunk}\n\n`));
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        },
      }),
    });

    const res = await request(app)
      .post('/api/chat')
      .send({
        model: 'v4-pro',
        messages: [{ role: 'user', content: 'Where is attention mentioned?' }],
        apiKey: 'test-key',
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_chunks',
              parameters: { type: 'object', properties: {}, required: [] },
            },
          },
        ],
      })
      .buffer(true);

    expect(res.status).toBe(200);
    const body = res.text;
    expect(body).toContain('"tool_calls"');
    expect(body).toContain('call_abc123');
  });

  it('streams content AND tool_calls in the same chunk', async () => {
    const chunk = JSON.stringify({
      id: 'resp-3',
      choices: [
        {
          delta: {
            content: 'Let me look that up',
            tool_calls: [
              {
                index: 0,
                id: 'call_x1',
                type: 'function',
                function: { name: 'get_chunk', arguments: '{"target":"Introduction"}' },
              },
            ],
          },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(c: ReadableStreamDefaultController) {
          c.enqueue(new TextEncoder().encode(`data: ${chunk}\n\n`));
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        },
      }),
    });

    const res = await request(app)
      .post('/api/chat')
      .send({
        model: 'v4-pro',
        messages: [{ role: 'user', content: 'hi' }],
        apiKey: 'test-key',
      })
      .buffer(true);

    expect(res.status).toBe(200);
    const body = res.text;
    expect(body).toContain('"content":"Let me look that up"');
    expect(body).toContain('"tool_calls"');
    expect(body).toContain('get_chunk');
  });

  it('handles fragmented tool_calls (arguments across multiple deltas)', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"id":"r4","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_y1","type":"function","function":{"name":"search_chunks","arguments":"{\\"query\\":\\"attention\\""}}]}}]}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"id":"r4","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

    const res = await request(app)
      .post('/api/chat')
      .send({
        model: 'v4-pro',
        messages: [{ role: 'user', content: 'test' }],
        apiKey: 'test-key',
      })
      .buffer(true);

    const body = res.text;
    expect(body).toContain('call_y1');
    expect(body).toContain('search_chunks');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('multiple tool calls in one response', async () => {
    const chunk = JSON.stringify({
      id: 'r5',
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_a',
                type: 'function',
                function: { name: 'list_chunks', arguments: '{}' },
              },
              {
                index: 1,
                id: 'call_b',
                type: 'function',
                function: { name: 'search_papers', arguments: '{"query":"diffusion"}' },
              },
            ],
          },
        },
      ],
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(c: ReadableStreamDefaultController) {
          c.enqueue(new TextEncoder().encode(`data: ${chunk}\n\n`));
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        },
      }),
    });

    const res = await request(app)
      .post('/api/chat')
      .send({
        model: 'v4-pro',
        messages: [{ role: 'user', content: 'multi' }],
        apiKey: 'test-key',
      })
      .buffer(true);

    const body = res.text;
    expect(body).toContain('call_a');
    expect(body).toContain('call_b');
  });

  it('no tools in request → clean text response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(c: ReadableStreamDefaultController) {
          c.enqueue(
            new TextEncoder().encode(
              'data: {"id":"r6","choices":[{"delta":{"content":"Plain text answer"}}]}\n\n',
            ),
          );
          c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          c.close();
        },
      }),
    });

    const res = await request(app)
      .post('/api/chat')
      .send({
        model: 'v4-flash',
        messages: [{ role: 'user', content: 'hello' }],
        apiKey: 'test-key',
      })
      .buffer(true);

    const body = res.text;
    expect(body).toContain('"content":"Plain text answer"');
    expect(body).not.toContain('tool_calls');
  });
});
