import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;
let research: typeof import('../research.js');
let researchConfig: typeof import('../researchConfig.js');
let mockFetch: ReturnType<typeof vi.fn>;

const { storeMock } = vi.hoisted(() => ({
  storeMock: {
    createPaper: vi.fn<
      (input: {
        pdfPath: string;
        id: string;
        tags: string[];
        area?: string;
        year?: string;
        source?: string;
      }) => Promise<unknown>
    >(),
    listPapers: vi.fn<() => { id: string }[]>(() => []),
    updatePaper: vi.fn(),
  },
}));

vi.mock('../store.js', () => storeMock);

function atomXml(entries: { id: string; title: string; published?: string }[]): string {
  const body = entries
    .map(
      (e) => `<entry>
    <id>http://arxiv.org/abs/${e.id}</id>
    <updated>${e.published ?? '2026-08-01T00:00:00Z'}</updated>
    <published>${e.published ?? '2026-08-01T00:00:00Z'}</published>
    <title>${e.title}</title>
    <summary>Abstract of ${e.title}.</summary>
    <author><name>Test Author</name></author>
    <category term="cs.CV" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${body}</feed>`;
}

const PDF_BYTES = Buffer.from('%PDF-1.4 fake pdf content');

function pdfResponse(): Response {
  return new Response(PDF_BYTES, { status: 200 });
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'papers-research-test-'));
  process.env.PAPERS_ROOT = tempDir;
  process.env.RESEARCH_ARXIV_DELAY_MS = '0';
  mkdirSync(join(tempDir, 'rawPDF'), { recursive: true });
  mkdirSync(join(tempDir, 'MD'), { recursive: true });
  mkdirSync(join(tempDir, 'MD', 'images'), { recursive: true });

  research = await import('../research.js');
  researchConfig = await import('../researchConfig.js');

  mockFetch = vi.fn(async (url: string) => {
    if (url.includes('/api/query')) {
      return new Response(atomXml([{ id: '2607.28936v1', title: 'DiffAttack' }]), { status: 200 });
    }
    if (url.includes('/pdf/')) return pdfResponse();
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', mockFetch);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('arxiv parsing', () => {
  it('normalizes arXiv ids', async () => {
    const { normalizeArxivId } = await import('../arxiv.js');
    expect(normalizeArxivId('2607.28936v1')).toBe('2607.28936');
    expect(normalizeArxivId('2607.28936')).toBe('2607.28936');
    expect(normalizeArxivId('http://arxiv.org/abs/2510.27285v4')).toBe('2510.27285');
    expect(normalizeArxivId('  ')).toBe('');
  });

  it('parses Atom XML entries', async () => {
    const { parseAtom } = await import('../arxiv.js');
    const entries = parseAtom(
      atomXml([
        { id: '2607.28936v1', title: 'DiffAttack: Evasion Attacks', published: '2026-07-31T01:33:53Z' },
        { id: '2607.25894v1', title: 'TIGA' },
      ]),
    );
    expect(entries).toHaveLength(2);
    const first = entries[0];
    expect(first.baseId).toBe('2607.28936');
    expect(first.arxivId).toBe('2607.28936v1');
    expect(first.title).toContain('DiffAttack');
    expect(first.published).toBe('2026-07-31T01:33:53Z');
    expect(first.authors).toEqual(['Test Author']);
    expect(first.categories).toEqual(['cs.CV', 'cs.LG']);
  });
});

describe('research config', () => {
  it('falls back to defaults when no config file exists', () => {
    const cfg = researchConfig.readResearchConfig();
    expect(cfg.schedule.cron).toBe('0 9 * * *');
    expect(cfg.directions.length).toBeGreaterThan(0);
    expect(cfg.directions[0].query).toContain('diffusion model');
  });

  it('keeps an explicit empty direction list', () => {
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
      schedule: { cron: '0 8 * * *', timezone: 'UTC' },
      maxPerRun: 2,
      directions: [],
      }),
    );
    const cfg = researchConfig.readResearchConfig();
    expect(cfg.directions).toEqual([]);
    expect(cfg.maxPerRun).toBe(2);
  });

  it('adds, updates and deletes directions', () => {
    const dir = researchConfig.addDirection({ name: '测试方向', query: 'abs:test', maxPerRun: 9 });
    expect(dir.enabled).toBe(true);
    expect(dir.maxPerRun).toBe(9);
    expect(() => researchConfig.addDirection({ name: '测试方向', query: 'abs:dup' })).toThrow(/已存在/);
    expect(() => researchConfig.addDirection({ name: '', query: 'abs:x' })).toThrow(/不能为空/);

    const updated = researchConfig.updateDirection('测试方向', { query: 'abs:updated', enabled: false });
    expect(updated?.query).toBe('abs:updated');
    expect(updated?.enabled).toBe(false);
    expect(researchConfig.updateDirection('不存在', { query: 'abs:x' })).toBeNull();

    expect(researchConfig.deleteDirection('测试方向')).toBe(true);
    expect(researchConfig.deleteDirection('测试方向')).toBe(false);
  });
});

describe('research check pipeline', () => {
  beforeEach(() => {
    storeMock.createPaper.mockReset();
    storeMock.createPaper.mockResolvedValue({ id: 'x', title: 'x' });
    storeMock.listPapers.mockReset();
    storeMock.listPapers.mockReturnValue([]);
    mockFetch.mockReset();
  });

  it('adds new papers and persists the run record', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/query')) {
        return new Response(
          atomXml([
            { id: '2607.28936v1', title: 'DiffAttack', published: '2026-07-31T00:00:00Z' },
            { id: '2607.25894v1', title: 'TIGA' },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/pdf/')) return pdfResponse();
      return new Response('not found', { status: 404 });
    });

    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '方向A', query: 'abs:test', enabled: true }],
      }),
    );

    const run = await research.checkNow();
    expect(run.status).toBe('success');
    expect(
      run.directions[0].papers.map((p) => p.status),
      JSON.stringify(run.directions[0].papers),
    ).toEqual(['added', 'added']);
    expect(storeMock.createPaper).toHaveBeenCalledTimes(2);
    expect(storeMock.createPaper.mock.calls[0][0]).toMatchObject({
      id: '2607.28936v1',
      area: '方向A',
      source: 'arxiv-auto',
      year: '2026',
    });

    const runs = research.listRuns();
    expect(runs).toHaveLength(1);
    expect(existsSync(join(tempDir, 'scan-runs.json'))).toBe(true);
    expect(research.getStatus().running).toBe(false);
  });

  it('marks papers already in the library as duplicate', async () => {
    storeMock.listPapers.mockReturnValue([{ id: '2607.28936v1' }]);
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/query')) {
        return new Response(
          atomXml([{ id: '2607.28936v1', title: 'DiffAttack' }, { id: '2607.25894v1', title: 'TIGA' }]),
          { status: 200 },
        );
      }
      if (url.includes('/pdf/')) return pdfResponse();
      return new Response('not found', { status: 404 });
    });

    const run = await research.checkNow();
    const statuses = run.directions[0].papers.map((p) => p.status);
    expect(statuses).toEqual(['duplicate', 'added']);
    expect(storeMock.createPaper).toHaveBeenCalledTimes(1);
  });

  it('records download failures', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/query')) {
        return new Response(atomXml([{ id: '2607.28936v1', title: 'DiffAttack' }]), { status: 200 });
      }
      return new Response('nope', { status: 404 });
    });

    const run = await research.checkNow();
    const paper = run.directions[0].papers[0];
    expect(paper.status).toBe('download_failed');
    expect(paper.error).toContain('404');
    expect(storeMock.createPaper).not.toHaveBeenCalled();
  });

  it('moves failed parses into mineru-failed and cleans rawPDF', async () => {
    storeMock.createPaper.mockRejectedValue(new Error('mineru exploded'));
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/query')) {
        return new Response(atomXml([{ id: '2607.28936v1', title: 'DiffAttack' }]), { status: 200 });
      }
      if (url.includes('/pdf/')) return pdfResponse();
      return new Response('not found', { status: 404 });
    });

    const run = await research.checkNow();
    const paper = run.directions[0].papers[0];
    expect(paper.status).toBe('parse_failed');
    expect(paper.error).toContain('mineru exploded');
    expect(existsSync(join(tempDir, 'mineru-failed', '2607.28936v1.pdf'))).toBe(true);
    expect(existsSync(join(tempDir, 'rawPDF', '2607.28936v1.pdf'))).toBe(false);
  });

  it('skips papers that failed in previous runs', async () => {
    mkdirSync(join(tempDir, 'mineru-failed'), { recursive: true });
    writeFileSync(join(tempDir, 'mineru-failed', '2607.28936v1.pdf'), PDF_BYTES);
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/query')) {
        return new Response(atomXml([{ id: '2607.28936v1', title: 'DiffAttack' }]), { status: 200 });
      }
      return pdfResponse();
    });

    const run = await research.checkNow();
    expect(run.directions[0].papers[0].status).toBe('previously_failed');
    expect(storeMock.createPaper).not.toHaveBeenCalled();
  });

  it('caps new papers at maxPerRun', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `2607.9000${i}v1`,
      title: `Paper ${i}`,
    }));
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/query')) return new Response(atomXml(entries), { status: 200 });
      if (url.includes('/pdf/')) return pdfResponse();
      return new Response('not found', { status: 404 });
    });
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '方向A', query: 'abs:test', enabled: true, maxPerRun: 2 }],
      }),
    );

    const run = await research.checkNow();
    expect(run.directions[0].papers.map((p) => p.status)).toEqual(['added', 'added']);
    expect(storeMock.createPaper).toHaveBeenCalledTimes(2);
  });

  it('rejects overlapping runs', async () => {
    let release: (() => void) | undefined;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/api/query')) {
        return new Promise((resolve) => {
          release = () => resolve(new Response(atomXml([]), { status: 200 }));
        });
      }
      return pdfResponse();
    });

    research.startCheck();
    await new Promise((r) => setTimeout(r, 30));
    await expect(research.checkNow()).rejects.toThrow(/正在进行/);
    release?.();
    await vi.waitFor(() => expect(research.getStatus().running).toBe(false), { timeout: 3000 });
  });

  it('records direction-level search errors', async () => {
    mockFetch.mockRejectedValue(new Error('arXiv timeout'));
    const run = await research.checkNow();
    expect(run.status).toBe('success');
    expect(run.directions[0].error).toContain('arXiv timeout');
    expect(storeMock.createPaper).not.toHaveBeenCalled();
  });
});
