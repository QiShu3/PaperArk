import { XMLParser } from 'fast-xml-parser';
import type { PaperEntry } from './sources.js';

export interface ArxivEntry {
  id: string;
  arxivId: string;
  baseId: string;
  title: string;
  summary: string;
  published: string;
  updated?: string;
  authors: string[];
  categories: string[];
  doi?: string;
}

export function normalizeArxivId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return '';
  const absIdx = trimmed.indexOf('/abs/');
  const raw = absIdx !== -1 ? trimmed.slice(absIdx + 5) : trimmed;
  const clean = raw.split(/[?#]/)[0].trim();
  return clean.replace(/v\d+$/i, '');
}

export function parseAtom(xml: string): ArxivEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    processEntities: true,
    trimValues: true,
  });
  const doc = parser.parse(xml) as {
    feed?: { entry?: Record<string, unknown> | Record<string, unknown>[] };
  };
  const entry = doc.feed?.entry;
  if (!entry) return [];
  const entries = Array.isArray(entry) ? entry : [entry];

  return entries.map((e) => {
    const id = typeof e.id === 'string' ? e.id : '';
    const rawTitle = typeof e.title === 'string' ? e.title : '';
    const rawSummary = typeof e.summary === 'string' ? e.summary : '';
    const rawPublished = typeof e.published === 'string' ? e.published : '';
    const rawUpdated = typeof e.updated === 'string' ? e.updated : '';

    const authorsRaw = e.author;
    const authors = Array.isArray(authorsRaw)
      ? authorsRaw
          .map((a) => {
            const name = (a as Record<string, unknown>)?.name;
            return typeof name === 'string' ? name : '';
          })
          .filter(Boolean)
      : typeof (authorsRaw as Record<string, unknown>)?.name === 'string'
        ? [String((authorsRaw as Record<string, unknown>).name)]
        : [];

    const catsRaw = e.category;
    const categories = Array.isArray(catsRaw)
      ? catsRaw
          .map((c) => {
            const term = (c as Record<string, unknown>)?.['@_term'];
            return typeof term === 'string' ? term : '';
          })
          .filter(Boolean)
      : typeof (catsRaw as Record<string, unknown>)?.['@_term'] === 'string'
        ? [String((catsRaw as Record<string, unknown>)['@_term'])]
        : [];

    return {
      id,
      arxivId: id.split('/abs/')[1] ?? id,
      baseId: normalizeArxivId(id),
      title: rawTitle.replace(/\s+/g, ' ').trim(),
      summary: rawSummary.trim(),
      published: rawPublished,
      updated: rawUpdated || undefined,
      authors,
      categories,
    };
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 429 限流重试基数（毫秒）。arXiv 边缘层按 IP+查询串限流，窗口可能持续几分钟，
 * 默认退避 30s/60s/90s；测试环境可调小。
 */
function rateLimitBaseMs(): number {
  const raw = Number(process.env.ARXIV_RATE_LIMIT_BASE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

/** 429 退避加入少量抖动，避免多查询同时撞墙后同步重试。测试可关掉。 */
function rateLimitJitterMs(): number {
  const raw = Number(process.env.ARXIV_RATE_LIMIT_JITTER_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5_000;
}

/** 503/504 短暂退避基数（毫秒）。 */
function transientBaseMs(): number {
  const raw = Number(process.env.ARXIV_TRANSIENT_BASE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 3000;
}

/** 429 单独多试几次，其余瞬时错误少试。 */
const RATE_LIMIT_ATTEMPTS = 4;
const TRANSIENT_ATTEMPTS = 3;

export async function searchArxiv(query: string, maxResults: number): Promise<ArxivEntry[]> {
  const params = new URLSearchParams({
    search_query: query,
    start: '0',
    max_results: String(Math.max(1, maxResults)),
    sortBy: 'submittedDate',
    sortOrder: 'descending',
  });
  const url = `https://export.arxiv.org/api/query?${params.toString()}`;
  const base = rateLimitBaseMs();
  const jitter = rateLimitJitterMs();
  const transient = transientBaseMs();
  let rateLimited = false;
  for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPTS + TRANSIENT_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
      headers: { Accept: 'application/atom+xml' },
    });
    if (res.ok) return parseAtom(await res.text());
    const is429 = res.status === 429;
    const isTransient = res.status === 503 || res.status === 504;
    if (is429) {
      rateLimited = true;
    } else if (!isTransient) {
      throw new Error(`arXiv API 请求失败 (HTTP ${res.status})`);
    }
    // 429 已发生则按限流窗口长时间退避；否则按 503/504 短退避。
    const attemptsLeft = rateLimited ? RATE_LIMIT_ATTEMPTS : TRANSIENT_ATTEMPTS;
    if (attempt >= attemptsLeft - 1) {
      throw new Error(`arXiv API 请求失败 (HTTP ${res.status})`);
    }
    // 优先遵守 Retry-After；否则按上述退避，并带少量抖动。
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 300_000)
      : rateLimited
        ? base * (attempt + 1) + Math.floor(Math.random() * jitter)
        : transient * (attempt + 1);
    await delay(waitMs);
  }
  throw new Error('arXiv API 请求失败');
}

/** 把 arXiv 直连结果适配为统一 PaperEntry（用于 research 流水线）。 */
export function arxivEntryToPaper(entry: ArxivEntry): PaperEntry {
  return {
    source: 'arxiv',
    sourceId: entry.arxivId,
    arxivId: entry.arxivId,
    title: entry.title,
    summary: entry.summary,
    published: entry.published,
    authors: entry.authors,
    categories: entry.categories,
    doi: entry.doi,
    pdfUrl: entry.arxivId ? `https://arxiv.org/pdf/${entry.arxivId}` : undefined,
  };
}
