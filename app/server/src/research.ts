import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PAPERS_ROOT, RAW_PDF_DIR, MINERU_FAILED_DIR } from './paths.js';
import { readResearchConfig } from './researchConfig.js';
import { searchArxiv, normalizeArxivId, arxivEntryToPaper } from './arxiv.js';
import { sanitizeStorageId, type PaperEntry } from './sources.js';
import * as paperClient from './paperClient.js';
import { createPaper, listPapers, updatePaper, type Paper } from './store.js';
import { classifyTitleAbstract } from './classify.js';
import { readSettings, getActiveProvider } from './settingsStore.js';
import * as vectorStore from './vectorStore.js';
import { logger } from './logger.js';

const RUNS_FILE = path.join(PAPERS_ROOT, 'scan-runs.json');
const RUNS_LIMIT = 50;
const ARXIV_DELAY_MS = 3000;
const PDF_TIMEOUT_MS = 120_000;

// arXiv 原生字段前缀。paper-search-mcp 会把查询硬包成 `all:...`，
// 字段化查询（如 abs:"..." AND ...）会被拼坏导致 arXiv 拒绝，因此这类查询绕过 MCP。
const FIELDED_QUERY = /^(ti|au|abs|co|jr|cat|rn|id|all):/i;

export type PaperStatus =
  | 'added'
  | 'duplicate'
  | 'download_failed'
  | 'parse_failed'
  | 'previously_failed';

export interface RunPaperResult {
  id: string;
  source: string;
  arxivId: string;
  title: string;
  status: PaperStatus;
  error?: string;
}

export interface RunDirectionResult {
  direction: string;
  query: string;
  papers: RunPaperResult[];
  error?: string;
}

export interface RunRecord {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success';
  directions: RunDirectionResult[];
}

let running = false;
let currentRun: RunRecord | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function arxivDelayMs(): number {
  const raw = Number(process.env.RESEARCH_ARXIV_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : ARXIV_DELAY_MS;
}

function readRuns(): RunRecord[] {
  try {
    const raw = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf-8'));
    return Array.isArray(raw) ? (raw as RunRecord[]) : [];
  } catch {
    return [];
  }
}

function writeRuns(runs: RunRecord[]): void {
  fs.mkdirSync(path.dirname(RUNS_FILE), { recursive: true });
  fs.writeFileSync(RUNS_FILE, JSON.stringify(runs.slice(0, RUNS_LIMIT), null, 2) + '\n', 'utf-8');
}

/** mineru-failed 目录里的文件按存储 id（sanitize 后）命名，直接比对。 */
function failedIds(): Set<string> {
  const ids = new Set<string>();
  try {
    for (const f of fs.readdirSync(MINERU_FAILED_DIR)) {
      if (f.endsWith('.pdf')) ids.add(path.basename(f, '.pdf'));
    }
  } catch {
    // directory missing: nothing failed yet
  }
  return ids;
}

async function downloadPdf(arxivId: string): Promise<string> {
  const url = `https://arxiv.org/pdf/${arxivId}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`PDF 下载失败 (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') throw new Error('下载内容不是 PDF');
  const tmp = path.join(os.tmpdir(), `arxiv-${arxivId}-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

function writeTmpPdf(entry: PaperEntry, buf: Buffer): string {
  const tmp = path.join(os.tmpdir(), `${entry.source}-${entry.sourceId.replace(/\W+/g, '-')}-${Date.now()}.pdf`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

/**
 * 下载 PDF：优先条目自带 pdf_url 直连（OpenAlex 等元数据源主路径），
 * 失败后走 paper-search MCP download_with_fallback（源站 → OA 仓库 → Unpaywall），
 * arXiv 源最后降级到 arxiv.org 直连。
 */
async function downloadPdfForEntry(entry: PaperEntry): Promise<string> {
  if (entry.pdfUrl && entry.source !== 'arxiv') {
    try {
      const buf = await paperClient.fetchPdfUrl(entry.pdfUrl);
      return writeTmpPdf(entry, buf);
    } catch (e) {
      logger.warn({ err: e, source: entry.source, sourceId: entry.sourceId }, 'pdf_url direct download failed');
    }
  }
  if (paperClient.paperSearchMcpEnabled()) {
    try {
      const p = await paperClient.downloadWithFallback({
        source: entry.source,
        paperId: entry.sourceId,
        doi: entry.doi,
        title: entry.title,
        savePath: os.tmpdir(),
      });
      if (p) return p;
      logger.warn({ source: entry.source, sourceId: entry.sourceId }, 'paper-search MCP download returned empty');
    } catch (e) {
      logger.warn({ err: e, source: entry.source, sourceId: entry.sourceId }, 'paper-search MCP download failed');
    }
  }
  if (entry.source === 'arxiv' && entry.arxivId) {
    return downloadPdf(entry.arxivId);
  }
  throw new Error(`无法下载 PDF (${entry.source}/${entry.sourceId})`);
}

/**
 * 单个源查询：字段化 arXiv 查询直连（MCP 会拼坏），其余走 MCP，arXiv 可降级直连。
 */
async function searchForQuery(
  source: string,
  query: string,
  limit: number,
): Promise<PaperEntry[]> {
  const maxResults = Math.max(limit * 3, 20);
  const fielded = source === 'arxiv' && FIELDED_QUERY.test(query.trim());
  if (fielded) {
    logger.info({ source, query }, 'fielded arXiv query, skipping paper-search MCP');
    return (await searchArxiv(query, maxResults)).map(arxivEntryToPaper);
  }
  if (paperClient.paperSearchMcpEnabled()) {
    try {
      const entries = await paperClient.searchEntries(query, source, maxResults);
      logger.info({ source, query, count: entries.length }, 'paper-search MCP search ok');
      return entries;
    } catch (e) {
      logger.warn({ err: e, source, query }, 'paper-search MCP search failed');
      if (source !== 'arxiv') throw e;
    }
  }
  if (source === 'arxiv') {
    return (await searchArxiv(query, maxResults)).map(arxivEntryToPaper);
  }
  throw new Error(`无法搜索源 ${source}（MCP 不可用且无直连降级）`);
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

interface LibraryIndex {
  byDoi: Map<string, Paper>;
  bySourceKey: Map<string, Paper>;
  byTitle: Map<string, Paper>;
}

function buildLibraryIndex(papers: Paper[]): LibraryIndex {
  const idx: LibraryIndex = { byDoi: new Map(), bySourceKey: new Map(), byTitle: new Map() };
  for (const p of papers) {
    if (p.doi) idx.byDoi.set(p.doi.trim().toLowerCase(), p);
    const src = p.source?.endsWith('-auto') ? p.source.slice(0, -'-auto'.length) : p.source;
    let srcId = p.sourceId;
    if (src === 'arxiv' && srcId) srcId = normalizeArxivId(srcId);
    srcId = srcId ?? (src === 'arxiv' ? normalizeArxivId(p.id) : undefined);
    if (src && srcId) idx.bySourceKey.set(`${src}:${srcId.toLowerCase()}`, p);
    const t = p.title ? normalizeTitle(p.title) : '';
    if (t && !idx.byTitle.has(t)) idx.byTitle.set(t, p);
  }
  return idx;
}

type DedupeKey = { kind: 'doi' | 'source' | 'title'; value: string };

/** 生成该条目的全部候选去重 key：DOI 优先，其次源内 ID，最后标题归一化兜底。 */
function dedupeKeysOf(entry: PaperEntry): DedupeKey[] {
  const keys: DedupeKey[] = [];
  if (entry.doi) keys.push({ kind: 'doi', value: entry.doi.trim().toLowerCase() });
  if (entry.sourceId) {
    const sid = entry.source === 'arxiv' ? normalizeArxivId(entry.sourceId) : entry.sourceId;
    if (sid) keys.push({ kind: 'source', value: `${entry.source}:${sid.toLowerCase()}` });
  }
  const t = normalizeTitle(entry.title);
  if (t) keys.push({ kind: 'title', value: t });
  return keys;
}

function lookupLibrary(idx: LibraryIndex, key: DedupeKey): Paper | null {
  if (key.kind === 'doi') return idx.byDoi.get(key.value) ?? null;
  if (key.kind === 'source') return idx.bySourceKey.get(key.value) ?? null;
  return idx.byTitle.get(key.value) ?? null;
}

function lookupAny(idx: LibraryIndex, keys: DedupeKey[]): Paper | null {
  for (const k of keys) {
    const hit = lookupLibrary(idx, k);
    if (hit) return hit;
  }
  return null;
}

/** 生成存储 id：arxiv 保留版本化 ID（兼容已有数据），其余源 sanitize。 */
function storageIdOf(entry: PaperEntry): string {
  if (entry.source === 'arxiv' && entry.arxivId) return entry.arxivId;
  return sanitizeStorageId(entry.source, entry.sourceId);
}

/** 用搜索到的 DOI 回填库内已有论文（元数据源发现用途）。 */
function backfillDoi(paper: Paper, doi?: string): void {
  if (!doi || paper.doi) return;
  try {
    updatePaper(paper.id, { doi: doi.trim() });
  } catch (e) {
    logger.warn({ err: e, id: paper.id }, 'failed to backfill doi');
  }
}

async function runCheck(runId: string): Promise<RunRecord> {
  const run: RunRecord = {
    runId,
    startedAt: new Date().toISOString(),
    status: 'running',
    directions: [],
  };
  running = true;
  currentRun = run;
  try {
    const cfg = readResearchConfig();
    const library = buildLibraryIndex(listPapers());
    const failed = failedIds();
    const settings = readSettings();

    for (const dir of cfg.directions.filter((d) => d.enabled)) {
      const result: RunDirectionResult = {
        direction: dir.name,
        query: dir.queries.map((q) => q.query).join(' | '),
        papers: [],
      };
      run.directions.push(result);
      const limit = Math.max(1, dir.maxPerRun ?? cfg.maxPerRun);
      const seen = new Set<string>();
      try {
        for (const q of dir.queries) {
          if (!(settings.sources[q.source]?.enabled ?? false)) {
            logger.info({ source: q.source, direction: dir.name }, 'source disabled, skipping direction query');
            continue;
          }
          await delay(arxivDelayMs());
          let entries: PaperEntry[] = [];
          try {
            entries = await searchForQuery(q.source, q.query, limit);
          } catch (e) {
            const msg = errorMessage(e);
            result.error = [result.error, msg].filter(Boolean).join('; ');
            logger.warn({ err: e, source: q.source, query: q.query }, 'search failed for direction query');
            continue;
          }
          let processedNew = 0;
          for (const entry of entries) {
            const storageId = storageIdOf(entry);
            const keys = dedupeKeysOf(entry);
            const newKeys = keys.filter((k) => !seen.has(k.value));
            if (newKeys.length === 0) continue;
            for (const k of newKeys) seen.add(k.value);

            const existing = lookupAny(library, keys);
            if (existing) {
              backfillDoi(existing, entry.doi);
              result.papers.push({
                id: storageId,
                source: entry.source,
                arxivId: entry.source === 'arxiv' ? (entry.arxivId ?? entry.sourceId) : entry.sourceId,
                title: entry.title,
                status: 'duplicate',
              });
              continue;
            }
            if (failed.has(storageId)) {
              result.papers.push({
                id: storageId,
                source: entry.source,
                arxivId: entry.source === 'arxiv' ? (entry.arxivId ?? entry.sourceId) : entry.sourceId,
                title: entry.title,
                status: 'previously_failed',
              });
              continue;
            }
            if (processedNew >= limit) break;
            processedNew++;
            try {
              const pdfPath = await downloadPdfForEntry(entry);
              try {
                await createPaper({
                  pdfPath,
                  id: storageId,
                  tags: [],
                  area: dir.name,
                  year: entry.published.slice(0, 4) || undefined,
                  source: `${entry.source}-auto`,
                  sourceId: entry.sourceId,
                  doi: entry.doi,
                });
                let matched: string[] = [dir.name];
                try {
                  const active = getActiveProvider(readSettings());
                  const directionNames = cfg.directions.map((d) => d.name);
                  if (active.apiKey && directionNames.length > 0) {
                    matched = await classifyTitleAbstract(
                      entry.title,
                      entry.summary,
                      directionNames,
                      active.apiKey,
                      active.baseUrl,
                    );
                  }
                } catch (e) {
                  logger.warn({ err: e, sourceId: entry.sourceId }, 'auto-classify failed, keep source direction');
                }
                if (!matched.includes(dir.name)) matched = [dir.name, ...matched];
                try {
                  updatePaper(storageId, { directions: matched });
                } catch (e) {
                  logger.warn({ err: e, sourceId: entry.sourceId }, 'failed to persist directions');
                }
                if (vectorStore.vectorEnabled()) {
                  void vectorStore.embedPaper(storageId).catch((e) =>
                    logger.warn({ err: e, sourceId: entry.sourceId }, 'auto embedding failed'),
                  );
                }
                result.papers.push({
                  id: storageId,
                  source: entry.source,
                  arxivId: entry.source === 'arxiv' ? (entry.arxivId ?? entry.sourceId) : entry.sourceId,
                  title: entry.title,
                  status: 'added',
                });
              } catch (e) {
                fs.rmSync(path.join(RAW_PDF_DIR, `${storageId}.pdf`), { force: true });
                if (fs.existsSync(pdfPath)) {
                  fs.mkdirSync(MINERU_FAILED_DIR, { recursive: true });
                  fs.copyFileSync(pdfPath, path.join(MINERU_FAILED_DIR, `${storageId}.pdf`));
                }
                result.papers.push({
                  id: storageId,
                  source: entry.source,
                  arxivId: entry.source === 'arxiv' ? (entry.arxivId ?? entry.sourceId) : entry.sourceId,
                  title: entry.title,
                  status: 'parse_failed',
                  error: errorMessage(e),
                });
              } finally {
                fs.rmSync(pdfPath, { force: true });
              }
            } catch (e) {
              result.papers.push({
                id: storageId,
                source: entry.source,
                arxivId: entry.source === 'arxiv' ? (entry.arxivId ?? entry.sourceId) : entry.sourceId,
                title: entry.title,
                status: 'download_failed',
                error: errorMessage(e),
              });
            }
          }
        }
      } catch (e) {
        result.error = errorMessage(e);
      }
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    run.status = 'success';
    const runs = readRuns();
    runs.unshift(run);
    writeRuns(runs);
    currentRun = run;
    running = false;
  }
  logger.info(
    { runId, directions: run.directions.length },
    'research check completed',
  );
  return run;
}

export function startCheck(): { runId: string } {
  if (running) throw new Error('已有自动检查正在进行');
  const runId = randomUUID();
  void runCheck(runId).catch((e) => logger.error({ err: e }, 'research check crashed'));
  return { runId };
}

export async function checkNow(): Promise<RunRecord> {
  if (running) throw new Error('已有自动检查正在进行');
  return runCheck(randomUUID());
}

export function getStatus(): { running: boolean; run: RunRecord | null } {
  return { running, run: currentRun ?? readRuns()[0] ?? null };
}

export function listRuns(): RunRecord[] {
  return readRuns();
}
