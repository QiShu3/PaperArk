import { Router, Request, Response } from 'express';
import * as sciverse from './sciverseClient.js';
import * as collection from './sciverseCollection.js';
import * as store from './store.js';
import * as vectorStore from './vectorStore.js';
import * as classify from './classify.js';
import { searchArxiv } from './arxiv.js';
import { sanitizeStorageId } from './sources.js';
import { readSettings, getActiveProvider } from './settingsStore.js';
import { logger } from './logger.js';

const router = Router();

function requireToken(res: Response): boolean {
  if (!sciverse.sciverseMcpEnabled()) {
    res.status(503).json({ error: 'Sciverse MCP 未启用（SCIVERSE_MCP_DISABLED=1）' });
    return false;
  }
  if (!sciverse.sciverseToken()) {
    res.status(400).json({ error: '请先在设置中配置 Sciverse Token' });
    return false;
  }
  return true;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
    .trim();
}

/** 原文外链分层解析：DOI → arXiv 标题搜索兜底。 */
async function resolveExternalLink(opts: {
  doi?: string;
  title: string;
}): Promise<string | undefined> {
  if (opts.doi && /^10\.\S+$/i.test(opts.doi.trim())) {
    return `https://doi.org/${opts.doi.trim()}`;
  }
  if (!opts.title) return undefined;
  try {
    const entries = await searchArxiv(`ti:"${opts.title}"`, 3);
    const hit = entries.find((e) => normalizeTitle(e.title) === normalizeTitle(opts.title)) ?? entries[0];
    if (hit?.arxivId) return `https://arxiv.org/abs/${hit.arxivId}`;
  } catch (e) {
    logger.warn({ err: e, title: opts.title }, 'arxiv title lookup failed for external link');
  }
  return undefined;
}

router.get('/status', (_req, res) => {
  res.json({
    enabled: sciverse.sciverseMcpEnabled(),
    tokenConfigured: !!sciverse.sciverseToken(),
  });
});

router.post('/semantic-search', async (req, res) => {
  if (!requireToken(res)) return;
  try {
    const raw = req.body as Record<string, unknown> | undefined;
    const query = typeof raw?.query === 'string' ? raw.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: '缺少 query' });
      return;
    }
    const topK = Math.min(20, Math.max(1, Number(raw?.top_k) || 10));
    const mode = typeof raw?.mode === 'string' && ['fast', 'balanced', 'quality'].includes(raw.mode)
      ? raw.mode
      : 'balanced';
    const hits = await sciverse.semanticSearch(query, topK, mode);
    res.json({ hits });
  } catch (e) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

router.post('/search-papers', async (req, res) => {
  if (!requireToken(res)) return;
  try {
    const raw = req.body as Record<string, unknown> | undefined;
    const pageSize = Math.min(50, Math.max(1, Number(raw?.page_size) || 10));
    const hits = await sciverse.searchPapers({
      query: typeof raw?.query === 'string' && raw.query.trim() ? raw.query.trim() : undefined,
      authors: Array.isArray(raw?.authors) ? (raw.authors as string[]) : undefined,
      yearFrom: typeof raw?.year_from === 'number' ? raw.year_from : undefined,
      pageSize,
    });
    res.json({ hits });
  } catch (e) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

router.post('/content', async (req, res) => {
  if (!requireToken(res)) return;
  try {
    const raw = req.body as Record<string, unknown> | undefined;
    const docId = typeof raw?.doc_id === 'string' ? raw.doc_id.trim() : '';
    if (!docId) {
      res.status(400).json({ error: '缺少 doc_id' });
      return;
    }
    const offset = Math.max(0, Number(raw?.offset) || 0);
    const limit = Math.min(100_000, Math.max(1, Number(raw?.limit) || 4096));
    const slice = await sciverse.readContent(docId, offset, limit);
    res.json(slice);
  } catch (e) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

router.post('/relations', async (req, res) => {
  if (!requireToken(res)) return;
  try {
    const raw = req.body as Record<string, unknown> | undefined;
    const uniqueId = typeof raw?.unique_id === 'string' ? raw.unique_id.trim() : '';
    const relation = String(raw?.relation ?? 'CITATIONS');
    if (!uniqueId) {
      res.status(400).json({ error: '缺少 unique_id' });
      return;
    }
    if (!['CITATIONS', 'REFERENCES', 'RELATED_WORKS'].includes(relation)) {
      res.status(400).json({ error: 'relation 仅支持 CITATIONS / REFERENCES / RELATED_WORKS' });
      return;
    }
    const page = Math.max(1, Number(raw?.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(raw?.page_size) || 25));
    const data = await sciverse.listPaperRelations(
      uniqueId,
      relation as 'CITATIONS' | 'REFERENCES' | 'RELATED_WORKS',
      page,
      pageSize,
    );
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

router.get('/catalog', async (_req, res) => {
  if (!requireToken(res)) return;
  try {
    const fields = await sciverse.listCatalog(true);
    res.json({ fields });
  } catch (e) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

router.get('/resource', async (req, res) => {
  if (!requireToken(res)) return;
  try {
    const fileName = String(req.query.file_name ?? '').trim();
    if (!fileName) {
      res.status(400).json({ error: '缺少 file_name' });
      return;
    }
    const { bytes, mimeType } = await sciverse.getResource(fileName);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.send(bytes);
  } catch (e) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

router.get('/collection', (_req, res) => {
  res.json({ items: collection.listFavorites() });
});

router.post('/collection', (req, res) => {
  const raw = req.body as Record<string, unknown> | undefined;
  const docId = typeof raw?.doc_id === 'string' ? raw.doc_id.trim() : '';
  if (!docId) {
    res.status(400).json({ error: '缺少 doc_id' });
    return;
  }
  const existing = collection.getFavorite(docId);
  if (existing) {
    res.status(201).json(existing);
    return;
  }
  const fav = collection.addFavorite({
    doc_id: docId,
    unique_id: typeof raw?.unique_id === 'string' ? raw.unique_id : undefined,
    title: typeof raw?.title === 'string' ? raw.title : docId,
    authors: Array.isArray(raw?.authors) ? (raw.authors as string[]) : [],
    year: typeof raw?.year === 'string' ? raw.year : undefined,
    venue: typeof raw?.venue === 'string' ? raw.venue : undefined,
    abstract: typeof raw?.abstract === 'string' ? raw.abstract : undefined,
    doi: typeof raw?.doi === 'string' ? raw.doi : undefined,
  });
  res.status(201).json(fav);
});

router.delete('/collection/:docId', (req, res) => {
  const ok = collection.removeFavorite(req.params.docId);
  res.json({ ok });
});

/**
 * 转正式入库：去重 → 全文直取 → createPaperFromMarkdown → 原文外链 → 后台向量化/分类。
 */
router.post('/promote', async (req, res) => {
  const raw = req.body as Record<string, unknown> | undefined;
  const docId = typeof raw?.doc_id === 'string' ? raw.doc_id.trim() : '';
  if (!docId) {
    res.status(400).json({ error: '缺少 doc_id' });
    return;
  }
  try {
    const fav = collection.getFavorite(docId);
    const title = fav?.title ?? (typeof raw?.title === 'string' && raw.title ? raw.title : docId);
    const doi = fav?.doi ?? (typeof raw?.doi === 'string' ? raw.doi : undefined);

    // 1. 去重：DOI/标题/存储 id 比对现有库
    const library = store.listPapers();
    const id = sanitizeStorageId('sciverse', docId);
    const existingById = library.find((p) => p.id === id);
    if (existingById) {
      res.json({ status: 'duplicate', paper: existingById });
      return;
    }
    const byDoi = new Map<string, store.Paper>();
    const byTitle = new Map<string, store.Paper>();
    for (const p of library) {
      if (p.doi) byDoi.set(p.doi.trim().toLowerCase(), p);
      const t = normalizeTitle(p.title);
      if (t && !byTitle.has(t)) byTitle.set(t, p);
    }
    const dup = doi ? (byDoi.get(doi.trim().toLowerCase()) ?? null) : null;
    const dupByTitle = byTitle.get(normalizeTitle(title));
    if (dup) {
      res.json({ status: 'duplicate', paper: dup });
      return;
    }
    if (dupByTitle) {
      if (doi) store.updatePaper(dupByTitle.id, { doi });
      res.json({ status: 'duplicate', paper: dupByTitle });
      return;
    }

    // 2. 全文直取：循环 readContent 拼接
    let markdown = '';
    let offset = 0;
    let guard = 0;
    for (;;) {
      if (++guard > 1000) throw new Error('全文读取超过安全上限');
      const slice = await sciverse.readContent(docId, offset, 30_000);
      markdown += slice.text;
      if (!slice.more || slice.next_offset <= offset) break;
      offset = slice.next_offset;
    }
    if (!markdown.trim()) throw new Error('未获取到全文内容');

    // 3. 入库（无 PDF）
    const externalUrl = await resolveExternalLink({ doi, title });
    const year = fav?.year ?? (typeof raw?.year === 'string' ? raw.year : undefined);
    const paper = store.createPaperFromMarkdown({
      id,
      markdown,
      tags: [],
      year,
      venue: fav?.venue,
      source: 'sciverse',
      sourceId: docId,
      doi,
      externalUrl,
    });

    // 4. 后台向量化 + AI 分类
    if (vectorStore.vectorEnabled()) {
      void vectorStore.embedPaper(paper.id).catch((e) =>
        logger.warn({ err: e, paperId: paper.id }, 'sciverse promote embedding failed'),
      );
    }
    void classify
      .classifyPaperById(paper.id)
      .then((directions) => {
        if (directions.length > 0) store.updatePaper(paper.id, { directions });
      })
      .catch((e) => logger.warn({ err: e, paperId: paper.id }, 'sciverse promote classify failed'));

    collection.removeFavorite(docId);
    res.json({ status: 'added', paper });
  } catch (e) {
    const message = errorMessage(e);
    logger.warn({ err: e, docId }, 'sciverse promote failed');
    res.status(500).json({ error: message });
  }
});

export default router;
