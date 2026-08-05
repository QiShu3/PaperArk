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
  it('calls search_papers with the arxiv source and maps metadata', async () => {
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
                authors: ['Test Author'],
                published_date: '2026-07-31T00:00:00Z',
                url: 'http://arxiv.org/abs/2607.28936v1',
                categories: ['cs.CV'],
                doi: '10.1234/diffattack',
              },
            ],
          }),
        },
      ],
    });

    const entries = await paperClient.searchEntries('diffusion', 20);

    expect(mockCallTool).toHaveBeenCalledTimes(1);
    const [params, options] = mockCallTool.mock.calls[0];
    expect(params).toMatchObject({
      name: 'search_papers',
      arguments: { query: 'diffusion', sources: 'arxiv', max_results_per_source: 20 },
    });
    expect(options).toMatchObject({ timeout: 120_000 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      arxivId: '2607.28936v1',
      baseId: '2607.28936',
      title: 'DiffAttack',
      summary: 'Abstract of DiffAttack.',
      doi: '10.1234/diffattack',
    });
  });

  it('unwraps the FastMCP structuredContent.result wrapper', async () => {
    mockCallTool.mockResolvedValue({
      structuredContent: { result: { papers: [{ paper_id: '2607.28936', title: 'T' }] } },
      content: [],
    });

    const entries = await paperClient.searchEntries('q', 5);
    expect(entries[0]).toMatchObject({ arxivId: '2607.28936', baseId: '2607.28936', title: 'T' });
  });

  it('throws when the tool reports an error', async () => {
    mockCallTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'boom' }],
    });
    await expect(paperClient.searchEntries('q', 5)).rejects.toThrow('boom');
  });
});

describe('paperClient.downloadWithFallback', () => {
  it('calls download_with_fallback with Sci-Hub disabled and returns the saved path', async () => {
    const pdfPath = join(tempDir, 'downloaded.pdf');
    writeFileSync(pdfPath, PDF_BYTES);
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: pdfPath }] });

    const path = await paperClient.downloadWithFallback({
      arxivId: '2607.28936v1',
      doi: '10.1234/diffattack',
      title: 'DiffAttack',
      savePath: tempDir,
    });

    expect(path).toBe(pdfPath);
    const [params] = mockCallTool.mock.calls[0];
    expect(params).toMatchObject({
      name: 'download_with_fallback',
      arguments: {
        source: 'arxiv',
        paper_id: '2607.28936v1',
        doi: '10.1234/diffattack',
        title: 'DiffAttack',
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
      paperClient.downloadWithFallback({ arxivId: 'x', savePath: tempDir }),
    ).rejects.toThrow(/Download failed/);
  });

  it('throws when the returned path does not exist', async () => {
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: join(tempDir, 'missing.pdf') }],
    });
    await expect(
      paperClient.downloadWithFallback({ arxivId: 'x', savePath: tempDir }),
    ).rejects.toThrow(/未生成文件/);
  });
});
