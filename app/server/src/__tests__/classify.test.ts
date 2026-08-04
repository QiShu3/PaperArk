import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;
let classify: typeof import('../classify.js');
let mockFetch: ReturnType<typeof vi.fn>;

function deepseekResponse(content: string): { ok: true; json: () => Promise<{ choices: { message: { content: string } }[] }> } {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'papers-classify-test-'));
  process.env.PAPERS_ROOT = tempDir;
  mkdirSync(join(tempDir, 'MD'), { recursive: true });
  mkdirSync(join(tempDir, 'MD', 'images'), { recursive: true });
  writeFileSync(
    join(tempDir, 'settings.json'),
    JSON.stringify({ apiKey: 'test-key', model: 'v4-flash' }),
  );
  classify = await import('../classify.js');
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const { closeDb } = await import('../db.js');
  closeDb();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe('extractTitleAndAbstract', () => {
  it('extracts title and bold Abstract', () => {
    const md = `# Test Paper\n\n**Abstract**\n\nThis is the abstract content.\n\n## Introduction\n\nBody.`;
    const { title, abstract } = classify.extractTitleAndAbstract(md);
    expect(title).toBe('Test Paper');
    expect(abstract).toContain('This is the abstract content.');
    expect(abstract).not.toContain('Introduction');
  });

  it('extracts Abstract with colon', () => {
    const md = `# Paper\n\n**Abstract:** short abstract here.\n\n## Methods\n\nBody.`;
    const { title, abstract } = classify.extractTitleAndAbstract(md);
    expect(title).toBe('Paper');
    expect(abstract).toContain('short abstract here.');
  });

  it('returns empty abstract when missing', () => {
    const { title, abstract } = classify.extractTitleAndAbstract('# No Abstract\n\n## Intro\n\nBody');
    expect(title).toBe('No Abstract');
    expect(abstract).toBe('');
  });
});

describe('classifyTitleAbstract', () => {
  it('returns only known direction names from model output', async () => {
    mockFetch.mockResolvedValueOnce(
      deepseekResponse('{"directions":["方向A","不存在的方向"]}'),
    );
    const result = await classify.classifyTitleAbstract('T', 'A', ['方向A', '方向B'], 'key');
    expect(result).toEqual(['方向A']);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('deepseek-v4-flash');
  });

  it('returns empty when model returns no directions', async () => {
    mockFetch.mockResolvedValueOnce(deepseekResponse('{"directions":[]}'));
    const result = await classify.classifyTitleAbstract('T', 'A', ['方向A'], 'key');
    expect(result).toEqual([]);
  });

  it('falls back to quoted names on malformed JSON', async () => {
    mockFetch.mockResolvedValueOnce(deepseekResponse('参考输出："方向B"'));
    const result = await classify.classifyTitleAbstract('T', 'A', ['方向A', '方向B'], 'key');
    expect(result).toEqual(['方向B']);
  });

  it('propagates upstream errors', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(classify.classifyTitleAbstract('T', 'A', ['方向A'], 'key')).rejects.toThrow(/401/);
  });
});

describe('classifyLibrary', () => {
  beforeEach(() => {
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [
          { name: '方向A', query: 'abs:a', enabled: true },
          { name: '方向B', query: 'abs:b', enabled: true },
        ],
      }),
    );
    writeFileSync(
      join(tempDir, 'MD', 'paper-a.md'),
      '# Paper A\n\n**Abstract**\n\nAbout diffusion attacks.\n\n## Intro\n\nBody.',
    );
    writeFileSync(
      join(tempDir, 'MD', 'paper-b.md'),
      '# Paper B\n\n**Abstract**\n\nAbout something else.\n\n## Intro\n\nBody.',
    );
    writeFileSync(join(tempDir, 'papers.json'), JSON.stringify({}));
    mockFetch.mockReset();
  });

  it('classifies papers missing directions and persists them', async () => {
    mockFetch.mockResolvedValue(deepseekResponse('{"directions":["方向A"]}'));
    await classify.classifyLibrary();

    const meta = JSON.parse(
      readFileSync(join(tempDir, 'papers.json'), 'utf-8'),
    ) as Record<string, { directions?: string[] }>;
    expect(meta['paper-a'].directions).toEqual(['方向A']);
    expect(meta['paper-b'].directions).toEqual(['方向A']);

    const status = classify.getClassifyStatus();
    expect(status.running).toBe(false);
    expect(status.current).toBe(2);
    expect(status.total).toBe(2);
    expect(status.matched).toBe(2);
    expect(status.failed).toBe(0);
  });

  it('skips papers that already have directions', async () => {
    writeFileSync(
      join(tempDir, 'papers.json'),
      JSON.stringify({ 'paper-b': { tags: [], directions: ['方向B'] } }),
    );
    mockFetch.mockResolvedValue(deepseekResponse('{"directions":["方向A"]}'));

    await classify.classifyLibrary();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const meta = JSON.parse(readFileSync(join(tempDir, 'papers.json'), 'utf-8'));
    expect(meta['paper-b'].directions).toEqual(['方向B']);
  });

  it('records per-paper failures and keeps going', async () => {
    mockFetch.mockRejectedValue(new Error('upstream down'));
    await classify.classifyLibrary();

    const status = classify.getClassifyStatus();
    expect(status.running).toBe(false);
    expect(status.failed).toBe(2);
    expect(status.errors.length).toBe(2);
  });

  it('throws synchronously when api key or directions are missing', () => {
    writeFileSync(join(tempDir, 'settings.json'), JSON.stringify({ apiKey: '', model: 'v4-flash' }));
    expect(() => classify.classifyLibrary()).toThrow(/API Key/);

    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ apiKey: 'test-key', model: 'v4-flash' }),
    );
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [],
      }),
    );
    expect(() => classify.classifyLibrary()).toThrow(/研究方向/);
  });
});
