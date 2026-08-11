import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Paper } from '../store.js';

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
    listPapers: vi.fn<() => Partial<Paper>[]>(() => []),
    updatePaper: vi.fn(),
  },
}));

vi.mock('../store.js', () => storeMock);

const { paperClientMock } = vi.hoisted(() => ({
  paperClientMock: {
    paperSearchMcpEnabled: vi.fn<() => boolean>(() => false),
    searchEntries: vi.fn<() => Promise<unknown>>(),
    downloadWithFallback: vi.fn<() => Promise<unknown>>(),
    fetchPdfUrl: vi.fn<() => Promise<unknown>>(),
  },
}));

vi.mock('../paperClient.js', () => paperClientMock);

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
  const { closeDb } = await import('../db.js');
  closeDb();
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
    expect(cfg.directions[0].queries[0].source).toBe('arxiv');
    expect(cfg.directions[0].queries[0].query).toContain('diffusion model');
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

  it('migrates legacy single-query directions to arxiv queries', () => {
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '旧方向', query: 'abs:legacy', enabled: true }],
      }),
    );
    const cfg = researchConfig.readResearchConfig();
    expect(cfg.directions[0].queries).toEqual([{ source: 'arxiv', query: 'abs:legacy' }]);
  });

  it('adds, updates and deletes directions with queries', () => {
    const dir = researchConfig.addDirection({
      name: '测试方向',
      queries: [{ source: 'openalex', query: 'test' }],
      maxPerRun: 9,
    });
    expect(dir.enabled).toBe(true);
    expect(dir.maxPerRun).toBe(9);
    expect(dir.queries).toEqual([{ source: 'openalex', query: 'test' }]);
    expect(() => researchConfig.addDirection({ name: '测试方向', queries: [{ source: 'arxiv', query: 'abs:dup' }] })).toThrow(/已存在/);
    expect(() => researchConfig.addDirection({ name: '', queries: [{ source: 'arxiv', query: 'abs:x' }] })).toThrow(/不能为空/);
    expect(() => researchConfig.addDirection({ name: '缺查询' })).toThrow(/不能为空/);

    const updated = researchConfig.updateDirection('测试方向', {
      queries: [{ source: 'iacr', query: 'secret sharing' }],
      enabled: false,
    });
    expect(updated?.queries).toEqual([{ source: 'iacr', query: 'secret sharing' }]);
    expect(updated?.enabled).toBe(false);
    expect(researchConfig.updateDirection('不存在', { query: 'abs:x' })).toBeNull();

    expect(researchConfig.deleteDirection('测试方向')).toBe(true);
    expect(researchConfig.deleteDirection('测试方向')).toBe(false);
  });

  it('exposes only whitelisted sources', () => {
    const sources = researchConfig.availableSources();
    expect(sources.map((s) => s.source)).toEqual(['arxiv', 'openalex', 'iacr']);
    expect(sources.find((s) => s.source === 'openalex')?.download).toBe(false);
  });
});

describe('research check pipeline', () => {
  beforeEach(() => {
    storeMock.createPaper.mockReset();
    storeMock.createPaper.mockResolvedValue({ id: 'x', title: 'x' });
    storeMock.listPapers.mockReset();
    storeMock.listPapers.mockReturnValue([]);
    mockFetch.mockReset();
    paperClientMock.paperSearchMcpEnabled.mockReset();
    paperClientMock.paperSearchMcpEnabled.mockReturnValue(false);
    paperClientMock.searchEntries.mockReset();
    paperClientMock.downloadWithFallback.mockReset();
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
    storeMock.listPapers.mockReturnValue([
      { id: '2607.28936v1', title: 'DiffAttack', source: 'arxiv-auto', sourceId: '2607.28936' },
    ]);
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

describe('paper-search MCP path', () => {
  beforeEach(() => {
    // 清理前面用例留下的 mineru-failed 标记，避免同一 arXiv ID 被判为 previously_failed
    rmSync(join(tempDir, 'mineru-failed'), { recursive: true, force: true });
    storeMock.createPaper.mockReset();
    storeMock.createPaper.mockResolvedValue({ id: 'x', title: 'x' });
    storeMock.listPapers.mockReset();
    storeMock.listPapers.mockReturnValue([]);
    mockFetch.mockReset();
    paperClientMock.paperSearchMcpEnabled.mockReset();
    paperClientMock.searchEntries.mockReset();
    paperClientMock.downloadWithFallback.mockReset();
  });

  it('uses MCP search + download when enabled', async () => {
    paperClientMock.paperSearchMcpEnabled.mockReturnValue(true);
    paperClientMock.searchEntries.mockResolvedValue([
      {
        source: 'arxiv',
        sourceId: '2607.28936',
        arxivId: '2607.28936v1',
        title: 'DiffAttack',
        summary: 'Abstract of DiffAttack.',
        published: '2026-07-31T00:00:00Z',
        authors: ['Test Author'],
        categories: ['cs.CV'],
        doi: '10.1234/diffattack',
      },
    ]);
    const mcpPdf = join(tempDir, 'mcp-download.pdf');
    writeFileSync(mcpPdf, PDF_BYTES);
    paperClientMock.downloadWithFallback.mockResolvedValue(mcpPdf);
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [
          { name: '方向A', enabled: true, queries: [{ source: 'arxiv', query: 'diffusion adversarial attack' }] },
        ],
      }),
    );

    const run = await research.checkNow();
    expect(run.directions[0].papers.map((p) => p.status)).toEqual(['added']);
    expect(paperClientMock.searchEntries).toHaveBeenCalledWith('diffusion adversarial attack', 'arxiv', 20);
    expect(paperClientMock.downloadWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'arxiv', paperId: '2607.28936', doi: '10.1234/diffattack' }),
    );
    expect(storeMock.createPaper).toHaveBeenCalledWith(
      expect.objectContaining({ id: '2607.28936v1', area: '方向A', source: 'arxiv-auto' }),
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to arXiv direct when MCP search fails', async () => {
    paperClientMock.paperSearchMcpEnabled.mockReturnValue(true);
    paperClientMock.searchEntries.mockRejectedValue(new Error('mcp down'));
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/query')) {
        return new Response(atomXml([{ id: '2607.28936v1', title: 'DiffAttack' }]), { status: 200 });
      }
      if (url.includes('/pdf/')) return pdfResponse();
      return new Response('not found', { status: 404 });
    });
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [
          { name: '方向A', enabled: true, queries: [{ source: 'arxiv', query: 'diffusion adversarial attack' }] },
        ],
      }),
    );

    const run = await research.checkNow();
    expect(run.directions[0].papers.map((p) => p.status)).toEqual(['added']);
    expect(paperClientMock.searchEntries).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalled();
    expect(storeMock.createPaper).toHaveBeenCalledWith(expect.objectContaining({ id: '2607.28936v1' }));
  });

  it('falls back to arXiv direct when MCP download fails', async () => {
    paperClientMock.paperSearchMcpEnabled.mockReturnValue(true);
    paperClientMock.searchEntries.mockResolvedValue([
      {
        source: 'arxiv',
        sourceId: '2607.28936',
        arxivId: '2607.28936v1',
        title: 'DiffAttack',
        summary: 'Abstract.',
        published: '2026-07-31T00:00:00Z',
        authors: ['Test Author'],
        categories: ['cs.CV'],
      },
    ]);
    paperClientMock.downloadWithFallback.mockRejectedValue(new Error('mcp download down'));
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/query')) return new Response(atomXml([]), { status: 200 });
      if (url.includes('/pdf/')) return pdfResponse();
      return new Response('not found', { status: 404 });
    });
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [
          { name: '方向A', enabled: true, queries: [{ source: 'arxiv', query: 'diffusion adversarial attack' }] },
        ],
      }),
    );

    const run = await research.checkNow();
    expect(run.directions[0].papers.map((p) => p.status)).toEqual(['added']);
    expect(paperClientMock.downloadWithFallback).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalled();
    expect(storeMock.createPaper).toHaveBeenCalledWith(expect.objectContaining({ id: '2607.28936v1' }));
  });

  it('routes fielded arXiv queries to the direct API instead of MCP', async () => {
    paperClientMock.paperSearchMcpEnabled.mockReturnValue(true);
    const pdf = join(tempDir, 'fielded-download.pdf');
    writeFileSync(pdf, PDF_BYTES);
    paperClientMock.downloadWithFallback.mockResolvedValue(pdf);
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/query')) {
        return new Response(atomXml([{ id: '2607.28936v1', title: 'DiffAttack' }]), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '方向A', enabled: true, queries: [{ source: 'arxiv', query: 'abs:test' }] }],
      }),
    );

    const run = await research.checkNow();
    expect(run.directions[0].papers.map((p) => p.status)).toEqual(['added']);
    expect(paperClientMock.searchEntries).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalled();
    expect(paperClientMock.downloadWithFallback).toHaveBeenCalled();
    expect(storeMock.createPaper).toHaveBeenCalledWith(expect.objectContaining({ id: '2607.28936v1' }));
  });
});

describe('multi-source research pipeline', () => {
  beforeEach(() => {
    rmSync(join(tempDir, 'mineru-failed'), { recursive: true, force: true });
    storeMock.createPaper.mockReset();
    storeMock.createPaper.mockResolvedValue({ id: 'x', title: 'x' });
    storeMock.listPapers.mockReset();
    storeMock.listPapers.mockReturnValue([]);
    storeMock.updatePaper.mockReset();
    mockFetch.mockReset();
    paperClientMock.paperSearchMcpEnabled.mockReset();
    paperClientMock.paperSearchMcpEnabled.mockReturnValue(true);
    paperClientMock.searchEntries.mockReset();
    paperClientMock.downloadWithFallback.mockReset();
    paperClientMock.fetchPdfUrl.mockReset();
    paperClientMock.fetchPdfUrl.mockResolvedValue(PDF_BYTES);
  });

  it('downloads OpenAlex entries via pdf_url direct and marks source', async () => {
    paperClientMock.searchEntries.mockResolvedValue([
      {
        source: 'openalex',
        sourceId: 'W2626778328',
        title: 'Attention Is All You Need',
        summary: 'Abstract.',
        published: '2017-06-12T00:00:00Z',
        authors: ['Ashish Vaswani'],
        categories: [],
        doi: '10.65215/2q58a426',
        pdfUrl: 'https://langtaosha.org.cn/preprint.pdf',
      },
    ]);
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '方向A', enabled: true, queries: [{ source: 'openalex', query: 'attention is all you need' }] }],
      }),
    );

    const run = await research.checkNow();
    expect(run.directions[0].papers.map((p) => p.status)).toEqual(['added']);
    expect(paperClientMock.searchEntries).toHaveBeenCalledWith('attention is all you need', 'openalex', 20);
    expect(paperClientMock.fetchPdfUrl).toHaveBeenCalledWith('https://langtaosha.org.cn/preprint.pdf');
    expect(paperClientMock.downloadWithFallback).not.toHaveBeenCalled();
    expect(storeMock.createPaper).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'openalex-W2626778328',
        area: '方向A',
        source: 'openalex-auto',
        sourceId: 'W2626778328',
        doi: '10.65215/2q58a426',
        year: '2017',
      }),
    );
    expect(run.directions[0].papers[0].source).toBe('openalex');
  });

  it('sanitizes slashes in IACR paper ids', async () => {
    paperClientMock.searchEntries.mockResolvedValue([
      {
        source: 'iacr',
        sourceId: '2026/1331',
        title: 'IACR Paper',
        summary: 'Abstract.',
        published: '2026-07-10T00:00:00Z',
        authors: ['Jiayu Xu'],
        categories: [],
      },
    ]);
    const iacrPdf = join(tempDir, 'iacr.pdf');
    writeFileSync(iacrPdf, PDF_BYTES);
    paperClientMock.downloadWithFallback.mockResolvedValue(iacrPdf);
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '方向A', enabled: true, queries: [{ source: 'iacr', query: 'secret sharing' }] }],
      }),
    );

    const run = await research.checkNow();
    expect(run.directions[0].papers[0].status).toBe('added');
    expect(paperClientMock.downloadWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'iacr', paperId: '2026/1331' }),
    );
    expect(storeMock.createPaper).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'iacr-2026-1331', source: 'iacr-auto' }),
    );
  });

  it('dedupes the same DOI across sources', async () => {
    storeMock.listPapers.mockReturnValue([
      {
        id: '2607.28936v1',
        title: 'DiffAttack',
        source: 'arxiv-auto',
        sourceId: '2607.28936',
        doi: '10.1234/diffattack',
      } as unknown as { id: string },
    ]);
    paperClientMock.searchEntries.mockResolvedValue([
      {
        source: 'openalex',
        sourceId: 'W99',
        title: 'DiffAttack',
        summary: 'Abstract.',
        published: '2026-07-31T00:00:00Z',
        authors: [],
        categories: [],
        doi: '10.1234/diffattack',
        pdfUrl: 'https://example.com/x.pdf',
      },
    ]);
    mockFetch.mockImplementation(async (url: string) => {
      if (url === 'https://example.com/x.pdf') return pdfResponse();
      return new Response('not found', { status: 404 });
    });
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '方向A', enabled: true, queries: [{ source: 'openalex', query: 'diffattack' }] }],
      }),
    );

    const run = await research.checkNow();
    expect(run.directions[0].papers.map((p) => p.status)).toEqual(['duplicate']);
    expect(storeMock.createPaper).not.toHaveBeenCalled();
  });

  it('backfills DOI on existing papers from metadata sources', async () => {
    storeMock.listPapers.mockReturnValue([
      {
        id: '2607.28936v1',
        title: 'DiffAttack',
        source: 'arxiv-auto',
        sourceId: '2607.28936',
        doi: undefined,
      } as unknown as { id: string },
    ]);
    paperClientMock.searchEntries.mockResolvedValue([
      {
        source: 'openalex',
        sourceId: 'W99',
        title: 'DiffAttack',
        summary: 'Abstract.',
        published: '2026-07-31T00:00:00Z',
        authors: [],
        categories: [],
        doi: '10.1234/diffattack',
        pdfUrl: 'https://example.com/x.pdf',
      },
    ]);
    mockFetch.mockImplementation(async (url: string) => {
      if (url === 'https://example.com/x.pdf') return pdfResponse();
      return new Response('not found', { status: 404 });
    });
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '方向A', enabled: true, queries: [{ source: 'openalex', query: 'diffattack' }] }],
      }),
    );

    const run = await research.checkNow();
    expect(run.directions[0].papers[0].status).toBe('duplicate');
    expect(storeMock.updatePaper).toHaveBeenCalledWith('2607.28936v1', { doi: '10.1234/diffattack' });
    expect(storeMock.createPaper).not.toHaveBeenCalled();
  });

  it('records direction-level error when a non-arxiv source search fails', async () => {
    paperClientMock.searchEntries.mockRejectedValue(new Error('openalex 500'));
    writeFileSync(
      join(tempDir, 'research.json'),
      JSON.stringify({
        schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
        maxPerRun: 5,
        directions: [{ name: '方向A', enabled: true, queries: [{ source: 'openalex', query: 'diffattack' }] }],
      }),
    );

    const run = await research.checkNow();
    expect(run.status).toBe('success');
    expect(run.directions[0].error).toContain('openalex 500');
    expect(storeMock.createPaper).not.toHaveBeenCalled();
  });
});

describe('searchArxiv retry', () => {
  it('retries transient 429 and succeeds', async () => {
    const { searchArxiv } = await import('../arxiv.js');
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(
        new Response(atomXml([{ id: '2607.28936v1', title: 'DiffAttack' }]), { status: 200 }),
      );
    vi.stubGlobal('fetch', f);
    try {
      const entries = await searchArxiv('abs:test', 10);
      expect(f).toHaveBeenCalledTimes(2);
      expect(entries).toHaveLength(1);
      expect(entries[0].baseId).toBe('2607.28936');
    } finally {
      vi.stubGlobal('fetch', mockFetch);
    }
  });
});
