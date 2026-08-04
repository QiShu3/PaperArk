import { XMLParser } from 'fast-xml-parser';

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

export async function searchArxiv(query: string, maxResults: number): Promise<ArxivEntry[]> {
  const params = new URLSearchParams({
    search_query: query,
    start: '0',
    max_results: String(Math.max(1, maxResults)),
    sortBy: 'submittedDate',
    sortOrder: 'descending',
  });
  const url = `https://export.arxiv.org/api/query?${params.toString()}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: 'application/atom+xml' },
  });
  if (!res.ok) throw new Error(`arXiv API 请求失败 (HTTP ${res.status})`);
  return parseAtom(await res.text());
}
