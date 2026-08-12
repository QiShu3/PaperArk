import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    sciverseMcpEnabled: vi.fn(),
    sciverseToken: vi.fn(),
    semanticSearch: vi.fn(),
    searchPapers: vi.fn(),
    readContent: vi.fn(),
    listPaperRelations: vi.fn(),
    getResource: vi.fn(),
    listCatalog: vi.fn(),
    closeSciverseClient: vi.fn(),
  },
}));

vi.mock('../sciverseClient.js', () => mockClient);

const { mockSearchArxiv } = vi.hoisted(() => ({ mockSearchArxiv: vi.fn() }));
vi.mock('../arxiv.js', () => ({
  searchArxiv: mockSearchArxiv,
  arxivEntryToPaper: () => ({}),
  normalizeArxivId: (s: string) => s,
}));

let app: Express;
let tempDir: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'sciverse-api-test-'));
  process.env.PAPERS_ROOT = tempDir;
  process.env.VITEST = '1';
  process.env.VECTOR_SERVICE_DISABLED = '1';

  mkdirSync(join(tempDir, 'MD'), { recursive: true });
  mkdirSync(join(tempDir, 'MD', 'images'), { recursive: true });
  mkdirSync(join(tempDir, 'rawPDF'), { recursive: true });

  vi.stubGlobal('fetch', vi.fn());

  const { createApp } = await import('../index.js');
  app = createApp();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  const { closeDb } = await import('../db.js');
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

function enableToken() {
  mockClient.sciverseMcpEnabled.mockReturnValue(true);
  mockClient.sciverseToken.mockReturnValue('sv-test-token');
}

describe('GET /api/sciverse/status', () => {
  it('reports disabled when MCP off', async () => {
    mockClient.sciverseMcpEnabled.mockReturnValue(false);
    mockClient.sciverseToken.mockReturnValue('');
    const res = await request(app).get('/api/sciverse/status');
    expect(res.body).toMatchObject({ enabled: false, tokenConfigured: false });
  });
});

describe('POST /api/sciverse/semantic-search', () => {
  it('requires a token first', async () => {
    mockClient.sciverseMcpEnabled.mockReturnValue(true);
    mockClient.sciverseToken.mockReturnValue('');
    const res = await request(app).post('/api/sciverse/semantic-search').send({ query: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Sciverse Token');
  });

  it('returns hits when token configured', async () => {
    enableToken();
    mockClient.semanticSearch.mockResolvedValue([{ doc_id: 'd_1', text: 'hello', score: 0.9 }]);
    const res = await request(app).post('/api/sciverse/semantic-search').send({ query: 'graphene', top_k: 5 });
    expect(res.status).toBe(200);
    expect(res.body.hits).toHaveLength(1);
    expect(mockClient.semanticSearch).toHaveBeenCalledWith('graphene', 5, 'balanced');
  });

  it('validates empty query', async () => {
    enableToken();
    const res = await request(app).post('/api/sciverse/semantic-search').send({ query: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/sciverse/content', () => {
  it('passes doc_id/offset/limit and returns slice', async () => {
    enableToken();
    mockClient.readContent.mockResolvedValue({ text: 'part', next_offset: 100, more: true });
    const res = await request(app).post('/api/sciverse/content').send({ doc_id: 'd_1', offset: 50, limit: 1000 });
    expect(res.status).toBe(200);
    expect(mockClient.readContent).toHaveBeenCalledWith('d_1', 50, 1000);
    expect(res.body).toMatchObject({ more: true, next_offset: 100 });
  });

  it('requires doc_id', async () => {
    enableToken();
    const res = await request(app).post('/api/sciverse/content').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/sciverse/relations', () => {
  it('validates relation type and calls client', async () => {
    enableToken();
    mockClient.listPaperRelations.mockResolvedValue({ items: [], totalCount: 0, page: 1, totalPages: 1 });
    const res = await request(app).post('/api/sciverse/relations').send({
      unique_id: 'paper:10.1234/x',
      relation: 'CITATIONS',
    });
    expect(res.status).toBe(200);
    expect(mockClient.listPaperRelations).toHaveBeenCalledWith('paper:10.1234/x', 'CITATIONS', 1, 25);
  });

  it('rejects bad relation', async () => {
    enableToken();
    const res = await request(app).post('/api/sciverse/relations').send({
      unique_id: 'u',
      relation: 'NOT_A_RELATION',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/sciverse/catalog', () => {
  it('returns fields', async () => {
    enableToken();
    mockClient.listCatalog.mockResolvedValue([{ name: 'year', type: 'Integer', filterable: true }]);
    const res = await request(app).get('/api/sciverse/catalog');
    expect(res.status).toBe(200);
    expect(res.body.fields[0].name).toBe('year');
  });
});

describe('GET /api/sciverse/resource', () => {
  it('streams bytes with content-type', async () => {
    enableToken();
    mockClient.getResource.mockResolvedValue({
      bytes: Buffer.from('pngdata'),
      mimeType: 'image/png',
    });
    const res = await request(app).get('/api/sciverse/resource?file_name=dt%3Dx%2Fp_y%2Ff3.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(Buffer.from(res.body as ArrayBuffer).toString()).toBe('pngdata');
  });
});

describe('/api/sciverse/collection', () => {
  it('adds, lists and removes favorites', async () => {
    const add = await request(app).post('/api/sciverse/collection').send({
      doc_id: 'd_fav1',
      title: 'Fav Paper',
      authors: ['A'],
      year: '2023',
      doi: '10.1234/fav',
    });
    expect(add.status).toBe(201);
    expect(add.body.title).toBe('Fav Paper');

    const list = await request(app).get('/api/sciverse/collection');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].doc_id).toBe('d_fav1');

    const del = await request(app).delete('/api/sciverse/collection/d_fav1');
    expect(del.body.ok).toBe(true);

    const list2 = await request(app).get('/api/sciverse/collection');
    expect(list2.body.items).toHaveLength(0);
  });

  it('is idempotent on re-add', async () => {
    await request(app).post('/api/sciverse/collection').send({ doc_id: 'd_fav2', title: 'X' });
    const again = await request(app).post('/api/sciverse/collection').send({ doc_id: 'd_fav2', title: 'Y' });
    expect(again.status).toBe(201);
    expect(again.body.title).toBe('X');
    const list = await request(app).get('/api/sciverse/collection');
    expect(list.body.items.filter((f: { doc_id: string }) => f.doc_id === 'd_fav2')).toHaveLength(1);
  });
});

describe('POST /api/sciverse/promote', () => {
  it('rejects unknown doc without full text', async () => {
    enableToken();
    mockClient.readContent.mockResolvedValue({ text: '', next_offset: 0, more: false });
    const res = await request(app).post('/api/sciverse/promote').send({ doc_id: 'd_empty', title: 'Empty' });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('未获取到全文');
  });

  it('promotes full text into the library and resolves arxiv external link', async () => {
    enableToken();
    await request(app).post('/api/sciverse/collection').send({
      doc_id: 'd_promo',
      title: 'Diffusion Adversarial Attacks',
      year: '2026',
    });
    mockClient.readContent
      .mockResolvedValueOnce({ text: '# Diffusion Adversarial Attacks\n\n## Intro\n\ncontent one\n\n## Method\n\nmethod text\n\n', next_offset: 30_000, more: true })
      .mockResolvedValueOnce({ text: '## Results\n\nfinal content\n', next_offset: 30_000, more: false });
    mockSearchArxiv.mockResolvedValue([
      {
        id: 'http://arxiv.org/abs/2607.12345v1',
        arxivId: '2607.12345',
        baseId: '2607.12345',
        title: 'Diffusion Adversarial Attacks',
        summary: 's',
        published: '2026-07-01',
        authors: [],
        categories: [],
      },
    ]);

    const res = await request(app).post('/api/sciverse/promote').send({ doc_id: 'd_promo' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('added');
    expect(res.body.paper.id).toBe('sciverse-d_promo');
    expect(res.body.paper.hasMd).toBe(true);
    expect(res.body.paper.hasPdf).toBe(false);
    expect(res.body.paper.externalUrl).toBe('https://arxiv.org/abs/2607.12345');
    expect(res.body.paper.source).toBe('sciverse');
    expect(mockSearchArxiv).toHaveBeenCalled();

    // favorite removed after promote
    const list = await request(app).get('/api/sciverse/collection');
    expect(list.body.items.some((f: { doc_id: string }) => f.doc_id === 'd_promo')).toBe(false);

    // dedupe on second promote attempt
    const dup = await request(app).post('/api/sciverse/promote').send({ doc_id: 'd_promo' });
    expect(dup.body.status).toBe('duplicate');
  });

  it('uses DOI link when present', async () => {
    enableToken();
    mockClient.readContent.mockResolvedValue({
      text: '# Title\n\n## Intro\n\nbody\n',
      next_offset: 0,
      more: false,
    });
    const res = await request(app).post('/api/sciverse/promote').send({
      doc_id: 'd_doi',
      title: 'Has DOI',
      doi: '10.9999/example',
    });
    expect(res.status).toBe(200);
    expect(res.body.paper.externalUrl).toBe('https://doi.org/10.9999/example');
  });
});
