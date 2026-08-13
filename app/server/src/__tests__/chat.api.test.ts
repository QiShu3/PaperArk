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

  it('uses the base URL configured in settings.json', async () => {
    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ apiKey: 'x', model: 'v4-flash', baseUrl: 'https://relay.example.com/v1/' }),
    );
    mockFetch.mockClear();
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"id":"1","choices":[{"delta":{"content":"ok"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, body: streamBody });

    await request(app)
      .post('/api/chat')
      .send({ model: 'v4-flash', messages: [{ role: 'user', content: 'hi' }], apiKey: 'test-key' })
      .buffer(true);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://relay.example.com/v1/chat/completions');
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

describe('POST /api/chat/test', () => {
  it('returns ok when the upstream responds', async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'pong' } }] }),
    });

    const res = await request(app)
      .post('/api/chat/test')
      .send({ apiKey: 'test-key', baseUrl: 'https://api.deepseek.com/v1', model: 'v4-flash' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.model).toBe('deepseek-v4-flash');
    expect(typeof res.body.latencyMs).toBe('number');
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(5);
  });

  it('reports upstream errors with status', async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid api key"}',
    });

    const res = await request(app)
      .post('/api/chat/test')
      .send({ apiKey: 'bad-key', baseUrl: 'https://api.deepseek.com/v1', model: 'v4-flash' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('401');
  });

  it('rejects when no API key is provided', async () => {
    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ apiKey: '', model: 'v4-flash' }),
    );
    try {
      const res = await request(app).post('/api/chat/test').send({ apiKey: '' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('API Key');
    } finally {
      writeFileSync(
        join(tempDir, 'settings.json'),
        JSON.stringify({ apiKey: 'x', model: 'v4-flash', baseUrl: 'https://relay.example.com/v1/' }),
      );
    }
  });
});

describe('POST /api/chat/title', () => {
  it('generates a title from the first message', async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '扩散模型对抗攻击' } }] }),
    });

    const res = await request(app)
      .post('/api/chat/title')
      .send({ text: '最近扩散模型对抗攻击有什么新进展', apiKey: 'test-key', model: 'v4-flash' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, title: '扩散模型对抗攻击' });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(300);
    expect(body.messages[1].content).toBe('最近扩散模型对抗攻击有什么新进展');
  });

  it('strips surrounding quotes from the generated title', async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '「对比两篇方法」' } }] }),
    });
    const res = await request(app)
      .post('/api/chat/title')
      .send({ text: '对比两篇论文的方法', apiKey: 'test-key' });
    expect(res.body.title).toBe('对比两篇方法');
  });

  it('requires message text', async () => {
    const res = await request(app).post('/api/chat/title').send({ text: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('缺少');
  });

  it('reports when the model returns empty content', async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    });
    const res = await request(app).post('/api/chat/title').send({ text: 'abc', apiKey: 'test-key' });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('未能生成');
  });

  it('falls back to reasoning_content when content is empty', async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '', reasoning_content: '根据用户消息生成的标题：扩散模型对抗攻击' } }],
      }),
    });
    const res = await request(app).post('/api/chat/title').send({ text: 'diffusion attack', apiKey: 'test-key' });
    expect(res.body.ok).toBe(true);
    expect(res.body.title).toContain('扩散模型对抗攻击');
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

describe('research endpoints', () => {
  it('returns default directions and available sources when no config exists', async () => {
    const res = await request(app).get('/api/research/directions');
    expect(res.status).toBe(200);
    expect(res.body.schedule.cron).toBe('0 9 * * *');
    expect(res.body.directions.length).toBeGreaterThan(0);
    expect(res.body.availableSources.map((s: { source: string }) => s.source)).toEqual(['arxiv', 'openalex', 'iacr']);
  });

  it('creates, validates, updates and deletes directions', async () => {
    const created = await request(app)
      .post('/api/research/directions')
      .send({ name: '测试方向', queries: [{ source: 'openalex', query: 'diffusion attack' }] });
    expect(created.status).toBe(201);
    expect(created.body.enabled).toBe(true);
    expect(created.body.queries).toEqual([{ source: 'openalex', query: 'diffusion attack' }]);

    const dup = await request(app)
      .post('/api/research/directions')
      .send({ name: '测试方向', queries: [{ source: 'arxiv', query: 'abs:other' }] });
    expect(dup.status).toBe(400);

    const empty = await request(app)
      .post('/api/research/directions')
      .send({ name: '空查询', queries: [{ source: 'arxiv', query: '   ' }] });
    expect(empty.status).toBe(400);

    const updated = await request(app)
      .put(`/api/research/directions/${encodeURIComponent('测试方向')}`)
      .send({ queries: [{ source: 'iacr', query: 'secret sharing' }], enabled: false, maxPerRun: 3 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      queries: [{ source: 'iacr', query: 'secret sharing' }],
      enabled: false,
      maxPerRun: 3,
    });

    const missing = await request(app)
      .put(`/api/research/directions/${encodeURIComponent('不存在')}`)
      .send({ queries: [{ source: 'arxiv', query: 'abs:x' }] });
    expect(missing.status).toBe(404);

    const list = await request(app).get('/api/research/directions');
    expect(list.body.directions.some((d: { name: string }) => d.name === '测试方向')).toBe(true);

    const del = await request(app).delete(`/api/research/directions/${encodeURIComponent('测试方向')}`);
    expect(del.status).toBe(200);
  });

  it('accepts legacy single-query payloads and migrates them to arxiv queries', async () => {
    const res = await request(app)
      .post('/api/research/directions')
      .send({ name: '旧格式', query: 'abs:legacy' });
    expect(res.status).toBe(201);
    expect(res.body.queries).toEqual([{ source: 'arxiv', query: 'abs:legacy' }]);
    await request(app).delete(`/api/research/directions/${encodeURIComponent('旧格式')}`);
  });

  it('runs a check and exposes status and run history', async () => {
    // Disable all directions so the background run completes instantly without network.
    const cfg = await request(app).get('/api/research/directions');
    for (const d of cfg.body.directions as { name: string }[]) {
      await request(app).delete(`/api/research/directions/${encodeURIComponent(d.name)}`);
    }

    const res = await request(app).post('/api/research/check');
    expect(res.status).toBe(202);
    expect(res.body.runId).toBeTruthy();

    await vi.waitFor(
      async () => {
        const st = await request(app).get('/api/research/status');
        expect(st.body.running).toBe(false);
      },
      { timeout: 5000 },
    );

    const runs = await request(app).get('/api/research/runs');
    expect(runs.status).toBe(200);
    expect(runs.body.length).toBeGreaterThan(0);
    expect(runs.body[0].status).toBe('success');
  });

  it('includes source/sourceId/doi in the papers list', async () => {
    writeFileSync(
      join(tempDir, 'papers.json'),
      JSON.stringify({
        'test-paper': { tags: [], source: 'arxiv-auto', sourceId: '2607.28936', doi: '10.1234/x' },
      }),
    );
    const res = await request(app).get('/api/papers');
    const paper = (res.body as { id: string; source?: string; sourceId?: string; doi?: string }[]).find(
      (p) => p.id === 'test-paper',
    );
    expect(paper?.source).toBe('arxiv-auto');
    expect(paper?.sourceId).toBe('2607.28936');
    expect(paper?.doi).toBe('10.1234/x');
  });

  it('rejects classification when API key is missing', async () => {
    const status = await request(app).get('/api/research/classify-status');
    expect(status.body).toMatchObject({ running: false, current: 0, total: 0 });

    const res = await request(app).post('/api/research/classify');
    expect(res.status).toBe(400);
  });

  it('starts classification and reports progress', async () => {
    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ apiKey: 'test-key', model: 'v4-flash' }),
    );
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '方向A', enabled: true, queries: [{ source: 'arxiv', query: 'abs:a' }] }],
      }),
    );
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"directions":[]}' } }] }),
    });

    const res = await request(app).post('/api/research/classify');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ started: true });

    await vi.waitFor(
      async () => {
        const st = await request(app).get('/api/research/classify-status');
        expect(st.body.running).toBe(false);
        expect(st.body.total).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
  });
});

describe('settings endpoints', () => {
  it('returns source views without key plaintext', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    const semantic = res.body.sources.find((s: { source: string }) => s.source === 'semantic');
    expect(semantic).toMatchObject({
      label: 'Semantic Scholar',
      download: true,
      keyEnv: 'PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY',
      enabled: false,
      hasKey: false,
    });
    expect(Object.keys(semantic)).not.toContain('key');
  });

  it('persists mineruToken through the settings API', async () => {
    const res = await request(app).put('/api/settings').send({ mineruToken: 'mt-abc' });
    expect(res.status).toBe(200);
    expect(res.body.mineruToken).toBe('mt-abc');

    const get = await request(app).get('/api/settings');
    expect(get.body.mineruToken).toBe('mt-abc');
  });

  it('persists sciverseToken through the settings API', async () => {
    const res = await request(app).put('/api/settings').send({ sciverseToken: 'sv-abc' });
    expect(res.status).toBe(200);
    expect(res.body.sciverseToken).toBe('sv-abc');

    const get = await request(app).get('/api/settings');
    expect(get.body.sciverseToken).toBe('sv-abc');
  });

  it('persists providers and activeProviderId through the settings API', async () => {
    const res = await request(app).put('/api/settings').send({
      providers: [
        { id: 'deepseek', name: 'DeepSeek', apiKey: 'sk-ds', baseUrl: 'https://a/v1' },
        { id: 'relay', name: 'MyRelay', apiKey: 'sk-relay', baseUrl: 'https://b/v1' },
      ],
      activeProviderId: 'relay',
    });
    expect(res.status).toBe(200);
    expect(res.body.providers).toHaveLength(2);
    expect(res.body.activeProviderId).toBe('relay');

    const get = await request(app).get('/api/settings');
    expect(get.body.providers).toHaveLength(2);
    expect(get.body.providers.find((p: { id: string }) => p.id === 'relay').apiKey).toBe('sk-relay');
    expect(get.body.activeProviderId).toBe('relay');
  });

  it('persists source enablement and key, then reflects in availableSources', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ sources: [{ source: 'semantic', enabled: true, key: 's2-secret' }] });
    expect(res.status).toBe(200);
    const semantic = res.body.sources.find((s: { source: string }) => s.source === 'semantic');
    expect(semantic.enabled).toBe(true);
    expect(semantic.hasKey).toBe(true);
    expect(Object.keys(semantic)).not.toContain('key');

    const dirs = await request(app).get('/api/research/directions');
    expect(dirs.body.availableSources.map((s: { source: string }) => s.source)).toContain('semantic');

    await request(app)
      .put('/api/settings')
      .send({ sources: [{ source: 'semantic', enabled: false }] });
  });
});
