import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PAPERS_ROOT, RAW_PDF_DIR, MINERU_FAILED_DIR } from './paths.js';
import { readResearchConfig } from './researchConfig.js';
import { searchArxiv, normalizeArxivId } from './arxiv.js';
import { createPaper, listPapers } from './store.js';
import { logger } from './logger.js';

const RUNS_FILE = path.join(PAPERS_ROOT, 'scan-runs.json');
const RUNS_LIMIT = 50;
const ARXIV_DELAY_MS = 3000;
const PDF_TIMEOUT_MS = 120_000;
const SEARCH_TIMEOUT_MS = 60_000;

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
        const entries = await searchArxiv(dir.query, Math.max(limit * 3, 20));
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
            const pdfPath = await downloadPdf(entry.arxivId);
            try {
              await createPaper({
                pdfPath,
                id: entry.arxivId,
                tags: [],
                area: dir.name,
                year: entry.published.slice(0, 4) || undefined,
                source: 'arxiv-auto',
              });
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
