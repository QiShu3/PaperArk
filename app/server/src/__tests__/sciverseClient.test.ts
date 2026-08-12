import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

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

import * as sciverse from '../sciverseClient.js';

beforeEach(async () => {
  mockCallTool.mockReset();
  await sciverse.closeSciverseClient();
});

afterAll(async () => {
  await sciverse.closeSciverseClient();
});

describe('sciverseClient.semanticSearch', () => {
  it('calls semantic_search with query/top_k/mode and maps hits', async () => {
    mockCallTool.mockResolvedValue({
      structuredContent: {
        result: {
          hits: [
            {
              doc_id: 'd_abc123',
              chunk_id: 'c_x',
              text: 'Graphene cathodes exhibit improved cycle stability.',
              score: 0.87,
              title: 'Cycle stability of graphene cathodes',
              source: { title: 'Cycle stability', year: 2023, venue: 'Nature' },
              offset: 18432,
              page_no: 4,
            },
          ],
        },
      },
      content: [],
    });

    const hits = await sciverse.semanticSearch('graphene battery', 10, 'quality');
    const [params] = mockCallTool.mock.calls[0];
    expect(params).toMatchObject({
      name: 'semantic_search',
      arguments: { query: 'graphene battery', top_k: 10, mode: 'quality' },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      doc_id: 'd_abc123',
      text: 'Graphene cathodes exhibit improved cycle stability.',
      score: 0.87,
      offset: 18432,
      page_no: 4,
      source: { year: 2023, venue: 'Nature' },
    });
  });

  it('throws when the MCP tool reports an error', async () => {
    mockCallTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'quota exceeded' }],
    });
    await expect(sciverse.semanticSearch('q')).rejects.toThrow('quota exceeded');
  });
});

describe('sciverseClient.searchPapers', () => {
  it('only sends provided args and maps paper hits', async () => {
    mockCallTool.mockResolvedValue({
      structuredContent: {
        result: {
          hits: [
            {
              doc_id: 'd_1',
              unique_id: 'paper:10.1234/x',
              title: 'Attention Is All You Need',
              authors: ['Ashish Vaswani'],
              year: 2017,
              venue: 'NeurIPS',
              doi: '10.1234/x',
              is_content_accessible: true,
              citation_count: 100,
            },
          ],
        },
      },
      content: [],
    });

    const hits = await sciverse.searchPapers({ query: 'transformer', yearFrom: 2020, pageSize: 5 });
    const [params] = mockCallTool.mock.calls[0];
    expect(params.arguments).toMatchObject({ query: 'transformer', year_from: 2020, page_size: 5 });
    expect(hits[0]).toMatchObject({
      doc_id: 'd_1',
      unique_id: 'paper:10.1234/x',
      doi: '10.1234/x',
      is_content_accessible: true,
      authors: ['Ashish Vaswani'],
    });
  });
});

describe('sciverseClient.readContent', () => {
  it('parses text/next_offset/more', async () => {
    mockCallTool.mockResolvedValue({
      structuredContent: {
        result: { text: 'part 1', next_offset: 4096, more: true },
      },
      content: [],
    });
    const slice = await sciverse.readContent('d_1', 0, 4096);
    const [params] = mockCallTool.mock.calls[0];
    expect(params.arguments).toMatchObject({ doc_id: 'd_1', offset: 0, limit: 4096 });
    expect(slice).toEqual({ text: 'part 1', next_offset: 4096, more: true });
  });

  it('returns default slice when the tool returns non-object text', async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'plain' }] });
    const slice = await sciverse.readContent('d_1');
    expect(slice.text).toBe('plain');
    expect(slice.more).toBe(false);
  });
});

describe('sciverseClient.listPaperRelations', () => {
  it('passes unique_id/relation and maps items', async () => {
    mockCallTool.mockResolvedValue({
      structuredContent: {
        result: {
          items: [{ id: '10.1080/x', id_type: 'doi', title: 'Some paper' }],
          total_count: 128,
          page: 1,
          total_pages: 6,
        },
      },
      content: [],
    });
    const data = await sciverse.listPaperRelations('paper:10.1234/x', 'CITATIONS', 1, 25);
    const [params] = mockCallTool.mock.calls[0];
    expect(params.arguments).toMatchObject({
      unique_id: 'paper:10.1234/x',
      relation: 'CITATIONS',
      page: 1,
      page_size: 25,
    });
    expect(data.items[0]).toMatchObject({ id: '10.1080/x', id_type: 'doi' });
    expect(data.totalCount).toBe(128);
  });
});

describe('sciverseClient.getResource', () => {
  it('decodes base64 bytes and mime type', async () => {
    const png = Buffer.from('fake-png-bytes');
    mockCallTool.mockResolvedValue({
      structuredContent: {
        result: { bytes: png.toString('base64'), mime_type: 'image/png' },
      },
      content: [],
    });
    const { bytes, mimeType } = await sciverse.getResource('dt=x/p_y/f3.png');
    const [params] = mockCallTool.mock.calls[0];
    expect(params.arguments).toMatchObject({ file_name: 'dt=x/p_y/f3.png' });
    expect(bytes.toString()).toBe('fake-png-bytes');
    expect(mimeType).toBe('image/png');
  });

  it('throws when bytes are missing', async () => {
    mockCallTool.mockResolvedValue({
      structuredContent: { result: { mime_type: 'image/png' } },
      content: [],
    });
    await expect(sciverse.getResource('dt=x/f.png')).rejects.toThrow(/无法解析/);
  });
});

describe('sciverseClient.listCatalog', () => {
  it('maps fields with capabilities', async () => {
    mockCallTool.mockResolvedValue({
      structuredContent: {
        result: {
          fields: [
            { name: 'publication_published_year', type: 'Integer', filterable: true, sortable: true, operators: ['EQ', 'GTE'] },
          ],
        },
      },
      content: [],
    });
    const fields = await sciverse.listCatalog(true);
    const [params] = mockCallTool.mock.calls[0];
    expect(params.arguments).toMatchObject({ include_sample_values: true });
    expect(fields[0]).toMatchObject({
      name: 'publication_published_year',
      filterable: true,
      operators: ['EQ', 'GTE'],
    });
  });
});
