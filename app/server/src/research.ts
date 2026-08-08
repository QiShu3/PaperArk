import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PAPERS_ROOT, RAW_PDF_DIR, MINERU_FAILED_DIR } from './paths.js';
import { readResearchConfig } from './researchConfig.js';
import { searchArxiv, normalizeArxivId, type ArxivEntry } from './arxiv.js';
import * as paperClient from './paperClient.js';
import { createPaper, listPapers, updatePaper } from './store.js';
import { classifyTitleAbstract } from './classify.js';
import { readSettings } from './settingsStore.js';
import * as vectorStore from './vectorStore.js';
import { logger } from './logger.js';

const RUNS_FILE = path.join(PAPERS_ROOT, 'scan-runs.json');
const RUNS_LIMIT = 50;
const ARXIV_DELAY_MS = 3000;
const PDF_TIMEOUT_MS = 120_000;
const SEARCH_TIMEOUT_MS = 60_000;

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

function failedIds(): Set<string> {
  const ids = new Set<string>();
  try {
    for (const f of fs.readdirSync(MINERU_FAILED_DIR)) {
      if (f.endsWith('.pdf')) ids.add(normalizeArxivId(path.basename(f, '.pdf')));
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

/**
 * 搜索论文：优先走 paper-search MCP（多源回退、自带重试/UA），
 * MCP 不可用时降级到 arXiv API 直连。
 */
async function searchForDirection(query: string, limit: number): Promise<ArxivEntry[]> {
  const maxResults = Math.max(limit * 3, 20);
  const fielded = FIELDED_QUERY.test(query.trim());
  if (!fielded && paperClient.paperSearchMcpEnabled()) {
    try {
      const entries = await paperClient.searchEntries(query, maxResults);
      logger.info({ query, count: entries.length }, 'paper-search MCP search ok');
      return entries;
    } catch (e) {
      logger.warn({ err: e, query }, 'paper-search MCP search failed, falling back to arXiv direct');
    }
  } else if (fielded) {
    logger.info({ query }, 'fielded arXiv query, skipping paper-search MCP');
  }
  return searchArxiv(query, maxResults);
}

/**
 * 下载 PDF：优先走 paper-search MCP 的 download_with_fallback
 * （源站 → OA 仓库 → Unpaywall），MCP 不可用时降级到 arxiv.org 直连。
 */
async function downloadPdfForEntry(entry: ArxivEntry): Promise<string> {
  if (paperClient.paperSearchMcpEnabled()) {
    try {
      const pdfPath = await paperClient.downloadWithFallback({
        arxivId: entry.arxivId,
        doi: entry.doi,
        title: entry.title,
        savePath: os.tmpdir(),
      });
      const buf = fs.readFileSync(pdfPath);
      if (buf.subarray(0, 4).toString('latin1') !== '%PDF') {
        throw new Error('MCP 下载内容不是 PDF');
      }
      return pdfPath;
    } catch (e) {
      logger.warn({ err: e, arxivId: entry.arxivId }, 'paper-search MCP download failed, falling back to arXiv direct');
    }
  }
  return downloadPdf(entry.arxivId);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
    const existing = new Set(listPapers().map((p) => normalizeArxivId(p.id)));
    const failed = failedIds();

    for (const dir of cfg.directions.filter((d) => d.enabled)) {
      const result: RunDirectionResult = { direction: dir.name, query: dir.query, papers: [] };
      run.directions.push(result);
      try {
        await delay(arxivDelayMs());
        const limit = Math.max(1, dir.maxPerRun ?? cfg.maxPerRun);
        const entries = await searchForDirection(dir.query, limit);
        const seen = new Set<string>();
        let processedNew = 0;
        for (const entry of entries) {
          if (!entry.baseId || seen.has(entry.baseId)) continue;
          seen.add(entry.baseId);
          if (existing.has(entry.baseId)) {
            result.papers.push({
              id: entry.baseId,
              arxivId: entry.arxivId,
              title: entry.title,
              status: 'duplicate',
            });
            continue;
          }
          if (failed.has(entry.baseId)) {
            result.papers.push({
              id: entry.baseId,
              arxivId: entry.arxivId,
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
                id: entry.arxivId,
                tags: [],
                area: dir.name,
                year: entry.published.slice(0, 4) || undefined,
                source: 'arxiv-auto',
              });
              let matched: string[] = [dir.name];
              try {
                const settings = readSettings();
                const directionNames = cfg.directions.map((d) => d.name);
                if (settings.apiKey && directionNames.length > 0) {
                  matched = await classifyTitleAbstract(
                    entry.title,
                    entry.summary,
                    directionNames,
                    settings.apiKey,
                  );
                }
              } catch (e) {
                logger.warn({ err: e, arxivId: entry.arxivId }, 'auto-classify failed, keep source direction');
              }
              if (!matched.includes(dir.name)) matched = [dir.name, ...matched];
              try {
                updatePaper(entry.arxivId, { directions: matched });
              } catch (e) {
                logger.warn({ err: e, arxivId: entry.arxivId }, 'failed to persist directions');
              }
              if (vectorStore.vectorEnabled()) {
                void vectorStore.embedPaper(entry.arxivId).catch((e) =>
                  logger.warn({ err: e, arxivId: entry.arxivId }, 'auto embedding failed'),
                );
              }
              result.papers.push({
                id: entry.baseId,
                arxivId: entry.arxivId,
                title: entry.title,
                status: 'added',
              });
            } catch (e) {
              fs.rmSync(path.join(RAW_PDF_DIR, `${entry.arxivId}.pdf`), { force: true });
              if (fs.existsSync(pdfPath)) {
                fs.mkdirSync(MINERU_FAILED_DIR, { recursive: true });
                fs.copyFileSync(pdfPath, path.join(MINERU_FAILED_DIR, `${entry.arxivId}.pdf`));
              }
              result.papers.push({
                id: entry.baseId,
                arxivId: entry.arxivId,
                title: entry.title,
                status: 'parse_failed',
                error: errorMessage(e),
              });
            } finally {
              fs.rmSync(pdfPath, { force: true });
            }
          } catch (e) {
            result.papers.push({
              id: entry.baseId,
              arxivId: entry.arxivId,
              title: entry.title,
              status: 'download_failed',
              error: errorMessage(e),
            });
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
