/**
 * 元数据多源补全（metaEnrich）
 *
 * 对库内论文（尤其 arXiv 来源的预印本）通过多个外部数据源「重新审查」，
 * 补全正式发表信息与作者/摘要：
 *
 *   1. arXiv 官方 API   —— 仅 arXiv 论文，按 arXiv ID 精确查询（journal_ref / DOI / authors / abstract）
 *   2. Sciverse         —— 结构化检索（title 匹配），authors/abstract/doi/venue/year 一次到位
 *   3. OpenAlex         —— arXiv 论文按 ids.arxiv 锚点，其余按 title.search
 *   4. Crossref         —— 按标题查权威 DOI + container-title
 *   5. Semantic Scholar —— 可选，仅当 settings.sources.semantic.key 已配置
 *
 * 刷新规则（补缺失 + 有限刷新）：
 *   - doi     空缺或非标准（不以 10. 开头）才填；合法 DOI 已有永不覆盖
 *   - venue   空缺 / 「未收录」/ arXiv 预印本标记可填；已填真实会议期刊名不覆盖
 *   - year    空缺可填；已有值时允许按权威源正式发表年刷新
 *   - authors 已有非空数组不覆盖；abstract 已有非空不覆盖
 *
 * 批量模式：单飞防重入；跳过元数据已完整的论文；支持进度查询。
 */
import { XMLParser } from 'fast-xml-parser';
import { listPapers, updatePaper } from './store.js';
import { logger } from './logger.js';
import { readSettings } from './settingsStore.js';
import * as sciverseClient from './sciverseClient.js';

const TIMEOUT_MS = 15_000;
const REQUEST_GAP_MS = 150;
// 预印本/非正式发表的 DOI 前缀（arXiv / engrXiv / SSRN）不作为「正式发表 DOI」补全
const PREPRINT_DOI_RE = /^10\.(48550|31224|2139)\//i;
const UNKNOWN_VENUE = '未收录';
const ARXIV_VENUE_RE = /^(arxiv|arxiv\.org|arxiv preprint|arxiv pre-print)$/i;
const ARXIV_ID_RE = /^\d{4}\.\d{4,5}(v\d+)?$/;

export interface EnrichedChanges {
  doi?: string;
  venue?: string;
  year?: string;
  authors?: string[];
  abstract?: string;
}

export interface EnrichResult {
  id: string;
  title: string;
  source: string; // 最后提供有效字段的源名
  updated: boolean;
  changes: EnrichedChanges;
}

export interface EnrichStatus {
  running: boolean;
  current: number;
  total: number;
  matched: number;
  skipped: number;
  failed: number;
  errors: string[];
}

let enriching = false;
let enrichStatus: EnrichStatus = {
  running: false,
  current: 0,
  total: 0,
  matched: 0,
  skipped: 0,
  failed: 0,
  errors: [],
};

export function getEnrichStatus(): EnrichStatus {
  return { ...enrichStatus, errors: [...enrichStatus.errors] };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isArxivId(id: string): boolean {
  return ARXIV_ID_RE.test(id.trim());
}

/* ---------------- 标题匹配 ---------------- */

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  const longer = ta.length >= tb.length ? ta : tb;
  const shorter = ta.length >= tb.length ? tb : ta;
  // 包含关系：短标题须占长标题 ≥60% 才算，防止「Watch Your Step」这类短标题被整句包含的误配
  if (shorter.length / longer.length >= 0.6) {
    if (longer.join(' ').includes(shorter.join(' '))) return 0.95;
  }
  // token 重合率：短标题过短（<4 词）不做模糊匹配；且短标题须占长标题 ≥50%，
  // 防止「Hidden in Plain Sight」这类通用短语标题被整句包含时误配
  const min = shorter.length;
  if (min < 4) return 0;
  const sizeRatio = min / longer.length;
  if (sizeRatio < 0.5) return 0;
  const setB = new Set(longer);
  const overlap = shorter.filter((t) => setB.has(t)).length;
  const ratio = overlap / min;
  return ratio >= MATCH_THRESHOLD ? ratio : 0;
}

const MATCH_THRESHOLD = 0.85;

function pickBest<T extends { title?: string }>(query: string, items: T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    if (!item.title) continue;
    const score = titleSimilarity(query, item.title);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

/* ---------------- 字段清洗 ---------------- */

function cleanDoi(raw?: string): string | undefined {
  if (!raw) return undefined;
  const doi = raw.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
  if (!doi || PREPRINT_DOI_RE.test(doi)) return undefined;
  return doi;
}

function cleanVenue(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v || ARXIV_VENUE_RE.test(v)) return undefined;
  return v;
}

function cleanAuthors(raw?: unknown): string[] | undefined {
  const list = Array.isArray(raw)
    ? raw.map((a) => (typeof a === 'string' ? a.trim() : '')).filter(Boolean)
    : [];
  return list.length > 0 ? [...new Set(list)] : undefined;
}

/** OpenAlex abstract_inverted_index 倒排索引还原为摘要文本。 */
export function restoreAbstract(inverted?: Record<string, number[]>): string | undefined {
  if (!inverted || typeof inverted !== 'object') return undefined;
  const words: { pos: number; word: string }[] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions ?? []) {
      if (typeof pos === 'number') words.push({ pos, word });
    }
  }
  if (words.length === 0) return undefined;
  words.sort((a, b) => a.pos - b.pos);
  return words.map((w) => w.word).join(' ').trim();
}

/* ---------------- 数据源查询 ---------------- */

interface ArxivApiEntry {
  title?: string;
  summary?: string;
  doi?: string;
  journal_ref?: string;
  authors: string[];
}

async function queryArxivApi(id: string): Promise<Partial<EnrichedChanges> | null> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/atom+xml' },
  });
  if (!res.ok) throw new Error(`arXiv API 请求失败 (HTTP ${res.status})`);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: true, trimValues: true });
  const doc = parser.parse(xml) as { feed?: { entry?: Record<string, unknown> } };
  const entry = doc.feed?.entry;
  if (!entry) return null;
  const authorsRaw = entry.author;
  const authors = Array.isArray(authorsRaw)
    ? authorsRaw
        .map((a) => {
          const name = (a as Record<string, unknown>)?.name;
          return typeof name === 'string' ? name.trim() : '';
        })
        .filter(Boolean)
    : typeof (authorsRaw as Record<string, unknown>)?.name === 'string'
      ? [String((authorsRaw as Record<string, unknown>).name)]
      : [];
  const title = typeof entry.title === 'string' ? entry.title.replace(/\s+/g, ' ').trim() : '';
  const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
  const journalRef =
    typeof entry['arxiv:journal_ref'] === 'string'
      ? entry['arxiv:journal_ref']
      : typeof entry.journal_ref === 'string'
        ? entry.journal_ref
        : '';
  const rawDoi = typeof entry['arxiv:doi'] === 'string' ? entry['arxiv:doi'] : (typeof entry.doi === 'string' ? entry.doi : '');
  return {
    doi: cleanDoi(rawDoi),
    venue: cleanVenue(journalRef),
    authors: cleanAuthors(authors),
    abstract: summary || undefined,
  };
}

async function querySciverse(title: string): Promise<Partial<EnrichedChanges> | null> {
  const hits = await sciverseClient.searchPapers({ query: title, pageSize: 5 });
  const best = pickBest(title, hits.map((h) => ({ title: h.title, _raw: h })));
  if (!best) return null;
  const h = best._raw;
  return {
    doi: cleanDoi(h.doi),
    venue: cleanVenue(h.venue),
    year: h.year ? String(h.year) : undefined,
    authors: cleanAuthors(h.authors),
    abstract: h.abstract?.trim() || undefined,
  };
}

interface OpenAlexWork {
  title?: string;
  doi?: string;
  publication_year?: number;
  primary_location?: { source?: { display_name?: string } };
  authorships?: { author?: { display_name?: string } }[];
  abstract_inverted_index?: Record<string, number[]>;
}

async function queryOpenAlex(
  title: string,
  arxivBaseId?: string,
): Promise<Partial<EnrichedChanges> | null> {
  const filter = arxivBaseId
    ? `ids.arxiv:${arxivBaseId}`
    : `title.search:${encodeURIComponent(title)}`;
  const url = `https://api.openalex.org/works?filter=${filter}&per-page=5&select=id,doi,title,publication_year,primary_location,authorships,abstract_inverted_index`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenAlex 请求失败 (HTTP ${res.status})`);
  const data = (await res.json()) as { results?: OpenAlexWork[] };
  const items = data.results ?? [];
  const best = arxivBaseId
    ? (items[0] ?? null)
    : pickBest(title, items.map((w) => ({ title: w.title, _raw: w })));
  if (!best) return null;
  const raw = '_raw' in best ? (best as { _raw: OpenAlexWork })._raw : (best as OpenAlexWork);
  const authors = cleanAuthors(
    (raw.authorships ?? []).map((a) => a.author?.display_name ?? ''),
  );
  return {
    doi: cleanDoi(raw.doi),
    venue: cleanVenue(raw.primary_location?.source?.display_name),
    year: raw.publication_year ? String(raw.publication_year) : undefined,
    authors,
    abstract: restoreAbstract(raw.abstract_inverted_index),
  };
}

interface CrossrefWork {
  title?: string[];
  DOI?: string;
  'container-title'?: string[];
  issued?: { 'date-parts'?: number[][] };
}

async function queryCrossref(title: string): Promise<Partial<EnrichedChanges> | null> {
  const url = `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=5&select=DOI,title,container-title,issued`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Crossref 请求失败 (HTTP ${res.status})`);
  const data = (await res.json()) as { message?: { items?: CrossrefWork[] } };
  const items = (data.message?.items ?? []).map((w) => ({ title: w.title?.[0], _raw: w }));
  const best = pickBest(title, items);
  if (!best) return null;
  const raw = best._raw;
  const year = raw.issued?.['date-parts']?.[0]?.[0];
  return {
    doi: cleanDoi(raw.DOI),
    venue: cleanVenue(raw['container-title']?.[0]),
    year: year ? String(year) : undefined,
  };
}

interface S2Work {
  title?: string;
  venue?: string;
  year?: number;
  externalIds?: { DOI?: string };
  authors?: { name?: string }[];
  abstract?: string;
}

async function querySemanticScholar(
  title: string,
  apiKey: string,
): Promise<Partial<EnrichedChanges> | null> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&fields=title,venue,year,externalIds,authors,abstract&limit=5`;
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Semantic Scholar 请求失败 (HTTP ${res.status})`);
  const data = (await res.json()) as { data?: S2Work[] };
  const best = pickBest(title, data.data ?? []);
  if (!best) return null;
  return {
    doi: cleanDoi(best.externalIds?.DOI),
    venue: cleanVenue(best.venue),
    year: best.year ? String(best.year) : undefined,
    authors: cleanAuthors((best.authors ?? []).map((a) => a.name ?? '')),
    abstract: best.abstract?.trim() || undefined,
  };
}

/* ---------------- 合并与写回 ---------------- */

function hasRealVenue(v?: string): boolean {
  return !!v && v !== UNKNOWN_VENUE;
}

function hasValidDoi(d?: string): boolean {
  return !!d && /^10\.\S+/.test(d) && !PREPRINT_DOI_RE.test(d);
}

/** 论文是否缺元数据（缺任一关键字段即需重新审查）。 */
export function needsEnrich(paper: {
  doi?: string;
  venue?: string;
  year?: string;
  authors?: string[];
  abstract?: string;
}): boolean {
  return (
    !hasValidDoi(paper.doi) ||
    !hasRealVenue(paper.venue) ||
    !paper.year ||
    !paper.authors?.length ||
    !paper.abstract
  );
}

/**
 * 按刷新规则把查询结果合并进当前值。
 * 返回本次实际要写回的变化字段。
 */
export function mergeChanges(
  current: {
    doi?: string;
    venue?: string;
    year?: string;
    authors?: string[];
    abstract?: string;
  },
  found: Partial<EnrichedChanges>,
  sourceName: string,
): { changes: EnrichedChanges; source: string } {
  const changes: EnrichedChanges = {};
  let source = sourceName;
  if (!hasValidDoi(current.doi) && found.doi) {
    changes.doi = found.doi;
  }
  if (!hasRealVenue(current.venue) && found.venue) {
    changes.venue = found.venue;
  }
  if (!current.year && found.year) {
    changes.year = found.year;
  } else if (current.year && found.year && found.year !== current.year) {
    // 允许按权威源正式发表年刷新
    changes.year = found.year;
  }
  if (!current.authors?.length && found.authors?.length) {
    changes.authors = found.authors;
  }
  if (!current.abstract && found.abstract) {
    changes.abstract = found.abstract;
  }
  const any = Object.keys(changes).length > 0;
  return { changes, source: any ? source : 'none' };
}

/** 单篇补全：多源轮询，只写按规则允许的字段。 */
export async function enrichPaper(id: string): Promise<EnrichResult> {
  const papers = listPapers();
  const paper = papers.find((p) => p.id === id);
  if (!paper) throw new Error(`论文不存在: ${id}`);
  if (!needsEnrich(paper)) {
    return { id, title: paper.title, source: 'none', updated: false, changes: {} };
  }

  const current = {
    doi: paper.doi,
    venue: paper.venue,
    year: paper.year,
    authors: paper.authors,
    abstract: paper.abstract,
  };
  let merged: EnrichedChanges = {};
  let source = 'none';
  const arxivId = isArxivId(paper.id) ? paper.id : isArxivId(paper.sourceId ?? '') ? paper.sourceId! : '';

  const sources: { name: string; query: () => Promise<Partial<EnrichedChanges> | null> }[] = [];
  if (arxivId) {
    sources.push({ name: 'arxiv', query: () => queryArxivApi(arxivId) });
  }
  if (sciverseClient.sciverseMcpEnabled() && sciverseClient.sciverseToken()) {
    sources.push({ name: 'sciverse', query: () => querySciverse(paper.title) });
  }
  sources.push({ name: 'openalex', query: () => queryOpenAlex(paper.title, arxivId ? arxivId.replace(/v\d+$/i, '') : undefined) });
  sources.push({ name: 'crossref', query: () => queryCrossref(paper.title) });
  const settings = readSettings();
  const s2Key = settings.sources?.semantic?.key?.trim();
  if (s2Key) {
    sources.push({ name: 'semantic', query: () => querySemanticScholar(paper.title, s2Key) });
  }

  for (const s of sources) {
    try {
      const found = await s.query();
      if (found) {
        const { changes, source: src } = mergeChanges({ ...current, ...merged }, found, s.name);
        if (Object.keys(changes).length > 0) {
          merged = { ...merged, ...changes };
          source = src;
        }
      }
    } catch (e) {
      logger.warn({ err: e, id, source: s.name }, 'meta enrich source query failed');
    }
    await delay(REQUEST_GAP_MS);
  }

  if (Object.keys(merged).length === 0) {
    return { id, title: paper.title, source, updated: false, changes: {} };
  }

  updatePaper(id, merged);
  logger.info({ id, source, changes: merged }, 'paper metadata enriched');
  return { id, title: paper.title, source, updated: true, changes: merged };
}

/* ---------------- 全库批量 ---------------- */

export function enrichLibrary(): Promise<void> {
  if (enriching) throw new Error('已有元数据补全任务正在进行');
  return runEnrichLibrary();
}

async function runEnrichLibrary(): Promise<void> {
  const papers = listPapers().sort((a, b) => a.id.localeCompare(b.id));
  enrichStatus = {
    running: true,
    current: 0,
    total: papers.length,
    matched: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  enriching = true;
  try {
    for (const p of papers) {
      if (!needsEnrich(p)) {
        enrichStatus.skipped += 1;
        enrichStatus.current += 1;
        continue;
      }
      try {
        const result = await enrichPaper(p.id);
        if (result.updated) enrichStatus.matched += 1;
      } catch (e) {
        enrichStatus.failed += 1;
        enrichStatus.errors.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
        logger.warn({ err: e, id: p.id }, 'paper metadata enrich failed');
      }
      enrichStatus.current += 1;
    }
  } finally {
    enrichStatus.running = false;
    enriching = false;
  }
}

// 供测试使用
export const _private = {
  queryArxivApi,
  querySciverse,
  queryOpenAlex,
  queryCrossref,
  querySemanticScholar,
  restoreAbstract,
};
