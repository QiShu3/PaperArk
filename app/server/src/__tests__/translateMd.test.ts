import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';

let tempDir: string;
let app: Express;
let translateMd: typeof import('../translateMd.js');
let mockFetch: ReturnType<typeof vi.fn>;

const MD = `# Privacy Evaluation of Generative Models

**Abstract**

Trajectory data is fundamental to modern urban intelligence.

## Introduction

Generative models such as GANs and Diffusion Models capture spatiotemporal distributions.

## Methods

The loss is $L = \\|x - D(z)\\|_2$ and the objective is:

$$\\min_G \\max_D V(D, G)$$

## References

[1] Some paper about diffusion models.
`;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'papers-md-translate-test-'));
  process.env.PAPERS_ROOT = tempDir;
  process.env.VITEST = '1';
  mkdirSync(join(tempDir, 'MD'), { recursive: true });
  mkdirSync(join(tempDir, 'MD', 'images'), { recursive: true });
  mkdirSync(join(tempDir, 'rawPDF'), { recursive: true });
  writeFileSync(join(tempDir, 'MD', 'test-paper.md'), MD);
  writeFileSync(join(tempDir, 'MD', 'paper2.md'), '# Second Paper\n\nBody text here.');
  writeFileSync(
    join(tempDir, 'settings.json'),
    JSON.stringify({ apiKey: 'test-key', model: 'v4-flash', baseUrl: 'https://api.deepseek.com/v1' }),
  );

  mockFetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '这是翻译后的内容。' } }] }),
  }));
  vi.stubGlobal('fetch', mockFetch);

  translateMd = await import('../translateMd.js');
  const { createApp } = await import('../index.js');
  app = createApp();
});

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '这是翻译后的内容。' } }] }),
  }));
});

afterEach(() => {
  translateMd.cleanupMdPaper('test-paper');
  translateMd.cleanupMdPaper('paper2');
  mockFetch.mockReset();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const { closeDb } = await import('../db.js');
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('splitSections', () => {
  it('splits by headings and keeps heading text', () => {
    const sections = translateMd.splitSections(MD);
    expect(sections.length).toBe(4);
    expect(sections[0]).toContain('# Privacy Evaluation');
    expect(sections[0]).toContain('**Abstract**');
    expect(sections[1]).toContain('## Introduction');
    expect(sections.some((s) => s.includes('## Methods'))).toBe(true);
    expect(sections.some((s) => s.includes('## References'))).toBe(true);
  });
});

describe('buildBatches', () => {
  it('respects the character limit and keeps LaTeX blocks intact', () => {
    const batches = translateMd.buildBatches(translateMd.splitSections(MD), 150);
    for (const b of batches) {
      const dollars = (b.match(/\$\$/g) ?? []).length;
      const fences = (b.match(/```/g) ?? []).length;
      expect(dollars % 2).toBe(0);
      expect(fences % 2).toBe(0);
    }
    expect(batches.length).toBeGreaterThan(1);
  });
});

describe('MD translation lifecycle', () => {
  it('translates the markdown and persists the output', async () => {
    const record = translateMd.startMdTranslation('test-paper');
    expect(record.status).toBe('running');

    await vi.waitFor(() => {
      expect(translateMd.getMdTranslationStatus('test-paper').status).toBe('done');
    }, { timeout: 5000 });

    expect(existsSync(translateMd.outputPath('test-paper'))).toBe(true);
    const content = translateMd.readMdTranslation('test-paper');
    expect(content).toContain('这是翻译后的内容。');
    expect(mockFetch).toHaveBeenCalled();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).model).toBe('deepseek-v4-flash');
  });

  it('returns cached status and content after completion', async () => {
    translateMd.startMdTranslation('test-paper');
    await vi.waitFor(() => {
      expect(translateMd.getMdTranslationStatus('test-paper').status).toBe('done');
    });
    mockFetch.mockClear();

    const again = translateMd.startMdTranslation('test-paper');
    expect(again.status).toBe('done');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('marks failures and allows retry', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));
    translateMd.startMdTranslation('test-paper');
    await vi.waitFor(() => {
      const s = translateMd.getMdTranslationStatus('test-paper');
      expect(s.status === 'failed' || s.status === 'done').toBe(true);
    }, { timeout: 10000 });
    expect(translateMd.getMdTranslationStatus('test-paper').status).toBe('failed');
  });

  it('retries transient empty responses', async () => {
    let calls = 0;
    mockFetch.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) };
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '这是翻译后的内容。' } }] }),
      };
    });

    translateMd.startMdTranslation('test-paper');
    await vi.waitFor(() => {
      expect(translateMd.getMdTranslationStatus('test-paper').status).toBe('done');
    }, { timeout: 10000 });
    expect(calls).toBeGreaterThan(1);
  });

  it('cancels a running translation', async () => {
    let release: (() => void) | undefined;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              json: async () => ({ choices: [{ message: { content: 'x' } }] }),
            } as Response);
        }),
    );
    translateMd.startMdTranslation('test-paper');
    await new Promise((r) => setTimeout(r, 30));
    const record = translateMd.cancelMdTranslation('test-paper');
    expect(record.status).toBe('cancelled');
    release?.();
    await new Promise((r) => setTimeout(r, 30));
    expect(translateMd.getMdTranslationStatus('test-paper').status).toBe('cancelled');
  });
});

describe('MD translation API', () => {
  it('starts, reports progress and returns content', async () => {
    const started = await request(app).post('/api/papers/test-paper/translate-md');
    expect(started.status).toBe(202);
    expect(started.body.status).toBe('running');

    await vi.waitFor(async () => {
      const st = await request(app).get('/api/papers/test-paper/translate-md');
      expect(st.body.status).toBe('done');
      expect(st.body.content).toContain('这是翻译后的内容。');
    }, { timeout: 5000 });
  });

  it('returns 404 when the paper has no markdown', async () => {
    const res = await request(app).post('/api/papers/no-md/translate-md');
    expect(res.status).toBe(404);
  });

  it('returns 409 while another paper is translating', async () => {
    let release: (() => void) | undefined;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              json: async () => ({ choices: [{ message: { content: 'x' } }] }),
            } as Response);
        }),
    );
    await request(app).post('/api/papers/test-paper/translate-md');
    await new Promise((r) => setTimeout(r, 30));

    const busy = await request(app).post('/api/papers/paper2/translate-md');
    expect(busy.status).toBe(409);
    release?.();
  });
});
