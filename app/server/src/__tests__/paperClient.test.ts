import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { mockCallTool } = vi.hoisted(() => ({ mockCallTool: vi.fn() }));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    async connect() {}
    async callTool(
      params: { name: string; arguments?: Record<string, unknown> },
      _schema?: unknown,
      options?: { timeout?: number },
    ) {
      return mockCallTool(params, options);
    }
    async close() {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(public server: { command: string; args: string[] }) {}
  },
}));

import * as paperClient from '../paperClient.js';

const PDF_BYTES = Buffer.from('%PDF-1.4 fake pdf content');
let tempDir: string;

beforeEach(async () => {
  mockCallTool.mockReset();
  await paperClient.closePaperClient();
});

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'paper-client-test-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('paperClient.searchEntries', () => {
  it('calls search_papers with the given source and maps metadata', async () => {
    mockCallTool.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            papers: [
              {
                paper_id: '2607.28936v1',
                title: 'DiffAttack',
                abstract: 'Abstract of DiffAttack.',
                authors: 'Test Author; Second Author',
                published_date: '2026-07-31T00:00:00Z',
                url: 'http://arxiv.org/abs/2607.28936v1',
                categories: 'cs.CV; cs.LG',
                doi: '10.1234/diffattack',
                source: 'arxiv',
                pdf_url: 'https://arxiv.org/pdf/2607.28936v1',
              },
            ],
          }),
        },
      ],
    });

    const entries = await paperClient.searchEntries('diffusion', 'arxiv', 20);

    expect(mockCallTool).toHaveBeenCalledTimes(1);
    const [params, options] = mockCallTool.mock.calls[0];
    expect(params).toMatchObject({
      name: 'search_papers',
      arguments: { query: 'diffusion', sources: 'arxiv', max_results_per_source: 20 },
    });
    expect(options).toMatchObject({ timeout: 120_000 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'arxiv',
      sourceId: '2607.28936v1',
      arxivId: '2607.28936v1',
      title: 'DiffAttack',
      summary: 'Abstract of DiffAttack.',
      doi: '10.1234/diffattack',
      pdfUrl: 'https://arxiv.org/pdf/2607.28936v1',
      authors: ['Test Author', 'Second Author'],
      categories: ['cs.CV', 'cs.LG'],
    });
  });

  it('maps non-arxiv sources with their paper_id as sourceId', async () => {
    mockCallTool.mockResolvedValue({
      structuredContent: {
        result: {
          papers: [
            {
              paper_id: 'W2626778328',
              title: 'Attention Is All You Need',
              authors: 'Ashish Vaswani; Noam Shazeer',
              abstract: 'Abstract.',
              doi: '10.65215/2q58a426',
              pdf_url: 'https://example.com/x.pdf',
              source: 'openalex',
              published_date: '2017-06-12T00:00:00Z',
            },
          ],
        },
      },
      content: [],
    });

    const entries = await paperClient.searchEntries('attention is all you need', 'openalex', 3);
    const [params] = mockCallTool.mock.calls[0];
    expect(params).toMatchObject({
      arguments: { query: 'attention is all you need', sources: 'openalex', max_results_per_source: 3 },
    });
    expect(entries[0]).toMatchObject({
      source: 'openalex',
      sourceId: 'W2626778328',
      arxivId: undefined,
      doi: '10.65215/2q58a426',
      pdfUrl: 'https://example.com/x.pdf',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
    });
  });

  it('keeps the versioned arxiv id as sourceId even when paper_id lacks it', async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ papers: [{ paper_id: '2607.28936', source: 'arxiv' }] }) }],
    });
    const entries = await paperClient.searchEntries('q', 'arxiv', 5);
    expect(entries[0].sourceId).toBe('2607.28936');
    expect(entries[0].arxivId).toBe('2607.28936');
  });

  it('throws when the tool reports an error', async () => {
    mockCallTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'boom' }],
    });
    await expect(paperClient.searchEntries('q', 'arxiv', 5)).rejects.toThrow('boom');
  });
});

describe('paperClient.downloadWithFallback', () => {
  it('calls download_with_fallback with Sci-Hub disabled and returns the saved path', async () => {
    const pdfPath = join(tempDir, 'downloaded.pdf');
    writeFileSync(pdfPath, PDF_BYTES);
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: pdfPath }] });

    const path = await paperClient.downloadWithFallback({
      source: 'iacr',
      paperId: '2026/1331',
      doi: '10.1234/x',
      title: 'IACR Paper',
      savePath: tempDir,
    });

    expect(path).toBe(pdfPath);
    const [params] = mockCallTool.mock.calls[0];
    expect(params).toMatchObject({
      name: 'download_with_fallback',
      arguments: {
        source: 'iacr',
        paper_id: '2026/1331',
        doi: '10.1234/x',
        title: 'IACR Paper',
        save_path: tempDir,
        use_scihub: false,
      },
    });
  });

  it('throws on an explicit MCP download failure message', async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Download failed after OA fallback chain. Details: primary: 404' }],
    });
    await expect(
      paperClient.downloadWithFallback({ source: 'arxiv', paperId: 'x', savePath: tempDir }),
    ).rejects.toThrow(/Download failed/);
  });

  it('throws when the returned path does not exist', async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: join(tempDir, 'missing.pdf') }],
    });
    await expect(
      paperClient.downloadWithFallback({ source: 'arxiv', paperId: 'x', savePath: tempDir }),
    ).rejects.toThrow(/未生成文件/);
  });
});

describe('paperClient.fetchPdfUrl', () => {
  it('returns the buffer when the response is a PDF', async () => {
    const fetchStub = vi.fn(async () => new Response(PDF_BYTES, { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    try {
      const buf = await paperClient.fetchPdfUrl('https://example.com/x.pdf');
      expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
      expect(fetchStub).toHaveBeenCalledWith(
        'https://example.com/x.pdf',
        expect.objectContaining({ signal: expect.anything() }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws when the response is not a PDF', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>nope</html>', { status: 200 })));
    try {
      await expect(paperClient.fetchPdfUrl('https://example.com/x.pdf')).rejects.toThrow(/不是 PDF/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws on HTTP error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })));
    try {
      await expect(paperClient.fetchPdfUrl('https://example.com/x.pdf')).rejects.toThrow(/403/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
