import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { RAW_PDF_DIR, IMAGES_DIR, WEB_DIST } from './paths.js';
import * as store from './store.js';
import chatRouter from './chat.js';
import * as chatStore from './chatStore.js';
import * as settingsStore from './settingsStore.js';
import * as research from './research.js';
import * as researchConfig from './researchConfig.js';
import * as classify from './classify.js';
import * as paperClient from './paperClient.js';
import * as sciverseClient from './sciverseClient.js';
import sciverseRouter from './sciverseApi.js';
import * as translateMd from './translateMd.js';
import * as vectorStore from './vectorStore.js';
import cron from 'node-cron';
import db, { insertPaper, saveChunks, chunkCount } from './db.js';
import { parseMd } from './chunker.js';
import { logger, requestIdMiddleware, getRequestId } from './logger.js';

export function createApp(): express.Express {
// Sync filesystem papers to SQLite so FK constraints are satisfied
for (const p of store.listPapers()) {
  const md = p.hasMd ? store.getRawMarkdown(p.id) : '';
  insertPaper(p.id, p.title, md.length);
  if (md && chunkCount(p.id) === 0) {
    const { chunks } = parseMd(md);
    saveChunks(p.id, chunks);
  }
}

// Ensure global chat paper entry exists for FK constraints
insertPaper('__global__', '全局对话', 0);
insertPaper('__sciverse__', 'Sciverse 工作区', 0);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(requestIdMiddleware);

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 200 * 1024 * 1024 } });

app.use('/rawPDF', express.static(RAW_PDF_DIR));
app.use('/MD/images', express.static(IMAGES_DIR));

app.use('/api', chatRouter);
app.use('/api/sciverse', sciverseRouter);

app.get('/api/papers', (_req, res) => {
  res.json(store.listPapers());
});

app.get('/api/tags', (_req, res) => {
  res.json(store.listTags());
});

app.get('/api/search', (req, res) => {
  res.json(store.search(String(req.query.q ?? '')));
});

app.get('/api/papers/:id', (req, res) => {
  const paper = store.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: '论文不存在' });
  res.json(paper);
});

app.post('/api/papers', upload.single('pdf'), async (req, res) => {
  const tmpFile = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: '需要上传 PDF 文件' });
    const rawId = String(req.body.id || '').trim() || path.basename(req.file.originalname, '.pdf');
    const id = rawId.replace(/[^\w.\-]/g, '_');
    if (!id) return res.status(400).json({ error: '无效的论文 ID' });
    const tags = String(req.body.tags || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const venue = String(req.body.venue || '').trim() || undefined;
    const year = String(req.body.year || '').trim() || undefined;
    const area = String(req.body.area || '').trim() || undefined;
    const paper = await store.createPaper({ pdfPath: req.file.path, id, tags, venue, year, area });
    if (vectorStore.vectorEnabled()) {
      void vectorStore.embedPaper(paper.id).catch((e) =>
        logger.warn({ err: e, paperId: paper.id }, 'auto embedding failed'),
      );
    }
    void classify
      .classifyPaperById(paper.id)
      .then((directions) => {
        if (directions.length > 0) store.updatePaper(paper.id, { directions });
      })
      .catch((e) => logger.warn({ err: e, paperId: paper.id }, 'manual upload classification failed'));
    res.json(paper);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  } finally {
    if (tmpFile) fs.rmSync(tmpFile, { force: true });
  }
});

app.put('/api/papers/:id', (req, res) => {
  const paper = store.updatePaper(req.params.id, req.body ?? {});
  if (!paper) return res.status(404).json({ error: '论文不存在' });
  res.json(paper);
});

app.delete('/api/papers/:id', (req, res) => {
  if (req.params.id === '__global__') return res.status(403).json({ error: '不能删除全局会话数据' });
  chatStore.deleteByPaper(req.params.id);
  translateMd.cleanupMdPaper(req.params.id);
  store.deletePaper(req.params.id);
  res.json({ ok: true });
});

app.post('/api/papers/:id/translate-md', (req, res) => {
  try {
    res.status(202).json(translateMd.startMdTranslation(req.params.id));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /没有 Markdown|不存在/.test(message) ? 404 : /正在翻译|正在进行/.test(message) ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

app.get('/api/papers/:id/translate-md', (req, res) => {
  const record = translateMd.getMdTranslationStatus(req.params.id);
  res.json({
    ...record,
    content: record.status === 'done' ? translateMd.readMdTranslation(req.params.id) : undefined,
  });
});

app.post('/api/papers/:id/translate-md/cancel', (req, res) => {
  res.json(translateMd.cancelMdTranslation(req.params.id));
});

app.post('/api/vector/embed-all', (_req, res) => {
  try {
    void vectorStore.embedAll().catch((e) =>
      logger.warn({ err: e }, 'library embedding failed'),
    );
    res.status(202).json({ started: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/vector/status', (_req, res) => {
  res.json(vectorStore.getEmbedStatus());
});

app.get('/api/papers/:id/semantic-search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: '缺少 query' });
    const topK = Math.min(10, Math.max(1, Number(req.query.top_k) || 5));
    res.json(await vectorStore.semanticSearch(q, req.params.id, topK));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/search/semantic', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: '缺少 query' });
    const topK = Math.min(10, Math.max(1, Number(req.query.top_k) || 5));
    res.json(await vectorStore.semanticSearch(q, undefined, topK));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/papers/:id/chunks', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q) {
    const rows = db
      .prepare(
        `SELECT c.id, c.chunk_index, c.heading, c.heading_level, c.parent_id, c.content, c.char_count
         FROM chunks_fts fts
         JOIN chunks c ON fts.rowid = c.id
         WHERE chunks_fts MATCH ? AND c.paper_id = ?
         ORDER BY rank
         LIMIT 50`
      )
      .all(q, req.params.id);
    res.json(rows);
  } else {
    const rows = db
      .prepare(
        `SELECT id, chunk_index, heading, heading_level, parent_id, content, char_count
         FROM chunks
         WHERE paper_id = ?
         ORDER BY chunk_index`
      )
      .all(req.params.id);
    res.json(rows);
  }
});

app.get('/api/papers/:id/sessions', (req, res) => {
  res.json(chatStore.listSessions(req.params.id));
});

app.post('/api/papers/:id/sessions', (req, res) => {
  const raw = req.body as Record<string, unknown> | undefined;
  const title = typeof raw?.title === 'string' ? raw.title : undefined;
  const session = chatStore.createSession(req.params.id, title);
  res.status(201).json(session);
});

app.put('/api/papers/:id/sessions/:sid', (req, res) => {
  const raw = req.body as Record<string, unknown> | undefined;
  const title = typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined;
  if (!title) return res.status(400).json({ error: '缺少标题' });
  chatStore.updateSessionTitle(req.params.sid, title);
  res.json({ ok: true });
});

app.delete('/api/papers/:id/sessions/:sid', (req, res) => {
  chatStore.deleteSession(req.params.sid);
  res.json({ ok: true });
});

app.get('/api/papers/:id/sessions/:sid/messages', (req, res) => {
  res.json(chatStore.loadChat(req.params.sid));
});

app.post('/api/papers/:id/sessions/:sid/messages', (req, res) => {
  const { messages } = req.body as { messages: { role: string; content: string }[] };
  if (!Array.isArray(messages)) return res.status(400).json({ error: '无效的消息列表' });
  chatStore.saveMessages(req.params.sid, req.params.id, messages);
  res.json({ ok: true });
});

app.delete('/api/papers/:id/sessions/:sid/messages', (req, res) => {
  chatStore.clearChat(req.params.sid);
  res.json({ ok: true });
});

app.get('/api/papers/:id/sessions/:sid/logs', (req, res) => {
  res.json(chatStore.getLogs(req.params.sid));
});

app.post('/api/papers/:id/sessions/:sid/logs/round-report', (req, res) => {
  const raw = req.body as Record<string, unknown> | undefined;
  const roundId = typeof raw?.round_id === 'string' ? raw.round_id : '';
  const toolResults = Array.isArray(raw?.tool_results) ? raw.tool_results as { name: string; success: boolean; error?: string }[] : [];
  if (!roundId) return res.status(400).json({ error: '缺少 round_id' });
  chatStore.appendToolResults(roundId, toolResults);
  res.json({ ok: true });
});

app.get('/api/settings', (_req, res) => {
  const s = settingsStore.readSettings();
  res.json({
    providers: s.providers,
    activeProviderId: s.activeProviderId,
    model: s.model,
    mineruToken: s.mineruToken,
    sciverseToken: s.sciverseToken,
    sources: settingsStore.sourceViews(s),
  });
});

app.put('/api/settings', (req, res) => {
  const next = settingsStore.writeSettings(req.body ?? {});
  res.json({
    providers: next.providers,
    activeProviderId: next.activeProviderId,
    model: next.model,
    mineruToken: next.mineruToken,
    sciverseToken: next.sciverseToken,
    sources: settingsStore.sourceViews(next),
  });
});

app.get('/api/research/directions', (_req, res) => {
  const cfg = researchConfig.readResearchConfig();
  res.json({
    schedule: cfg.schedule,
    maxPerRun: cfg.maxPerRun,
    directions: cfg.directions,
    availableSources: researchConfig.availableSources(),
  });
});

app.post('/api/research/directions', (req, res) => {
  try {
    const dir = researchConfig.addDirection(req.body ?? {});
    res.status(201).json(dir);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/research/directions/:name', (req, res) => {
  try {
    const dir = researchConfig.updateDirection(req.params.name, req.body ?? {});
    if (!dir) return res.status(404).json({ error: '研究方向不存在' });
    res.json(dir);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/research/directions/:name', (req, res) => {
  const ok = researchConfig.deleteDirection(req.params.name);
  if (!ok) return res.status(404).json({ error: '研究方向不存在' });
  res.json({ ok: true });
});

app.post('/api/research/check', (_req, res) => {
  try {
    res.status(202).json(research.startCheck());
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/research/status', (_req, res) => {
  res.json(research.getStatus());
});

app.get('/api/research/runs', (_req, res) => {
  res.json(research.listRuns());
});

app.post('/api/research/classify', (_req, res) => {
  try {
    void classify.classifyLibrary().catch((e) => logger.error({ err: e }, 'classify library failed'));
    res.status(202).json({ started: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(e instanceof Error && message.includes('正在进行') ? 409 : 400).json({ error: message });
  }
});

app.get('/api/research/classify-status', (_req, res) => {
  res.json(classify.getClassifyStatus());
});

app.get('/api/papers/:id/images', (req, res) => {
  const paper = store.getPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: '论文不存在' });
  if (!paper.hasMd) return res.json({ images: [] });

  try {
    const md = store.getRawMarkdown(req.params.id);
    if (!md) return res.json({ images: [] });
    const imageRe = /!\[.*?\]\(([^)]+)\)/g;
    const images: string[] = [];
    for (const m of md.matchAll(imageRe)) {
      const src = m[1];
      if (src && !images.includes(src)) {
        images.push(src);
      }
    }
    res.json({ images });
  } catch (e) {
    logger.error({ err: e, requestId: getRequestId(req) }, 'failed to list images');
    res.json({ images: [] });
  }
});

  // Global error handler
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, requestId: getRequestId(req) }, 'unhandled error');
      res.status(500).json({
        error: {
          code: 'INTERNAL',
          message,
          requestId: getRequestId(req),
        },
      });
    },
  );

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(WEB_DIST));
    app.get('*', (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }

  return app;
}

if (!process.env.VITEST) {
  const app = createApp();
  const PORT = Number(process.env.PORT || 3001);
  app.listen(PORT, () => {
    console.log(`API server running at http://localhost:${PORT}`);
  });
  const shutdown = () => {
    void Promise.all([
      paperClient.closePaperClient(),
      sciverseClient.closeSciverseClient(),
    ]).finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  const cfg = researchConfig.readResearchConfig();
  if (cron.validate(cfg.schedule.cron)) {
    cron.schedule(
      cfg.schedule.cron,
      () => {
        try {
          research.startCheck();
        } catch (e) {
          logger.warn({ err: e }, 'scheduled research check skipped');
        }
      },
      { timezone: cfg.schedule.timezone || undefined },
    );
    logger.info({ cron: cfg.schedule.cron, timezone: cfg.schedule.timezone }, 'research scheduler started');
  } else {
    logger.warn({ cron: cfg.schedule.cron }, 'invalid research schedule cron, scheduler disabled');
  }
}
