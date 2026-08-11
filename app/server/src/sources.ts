/**
 * 论文源统一定义：源标识、展示名、下载能力。
 *
 * download=false 的源（如 openalex）只做元数据发现 + DOI 回填，
 * 不保证能拿到 PDF，靠条目自带 pdf_url 或 OA 回退链碰运气。
 */
export const SOURCE_INFO: Record<string, { label: string; download: boolean }> = {
  arxiv: { label: 'arXiv', download: true },
  semantic: { label: 'Semantic Scholar', download: true },
  openalex: { label: 'OpenAlex', download: false },
  iacr: { label: 'IACR', download: true },
  zenodo: { label: 'Zenodo', download: true },
};

/**
 * 第一版开放的源白名单（配置/UI 可选项）。
 * semantic 需配 PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY 才稳定；
 * zenodo 上游 MCP 0.1.4 有 published_date 解析 bug，暂缓。
 */
export const AVAILABLE_SOURCES: string[] = ['arxiv', 'openalex', 'iacr'];

export interface PaperEntry {
  /** 原生源标识（arxiv / semantic / openalex / iacr / zenodo） */
  source: string;
  /** 源内唯一 ID（如 openalex 的 W2626778328、iacr 的 2026/1331） */
  sourceId: string;
  /** arXiv 版本化 ID（仅 arxiv 源，如 2607.28936v1）；其余源无此字段 */
  arxivId?: string;
  title: string;
  summary: string;
  published: string;
  authors: string[];
  categories: string[];
  doi?: string;
  pdfUrl?: string;
}

/**
 * 生成文件系统/数据库安全且稳定的存储 id。
 * arxiv 保留原 ID（兼容已有数据）；其余源用 `source-sourceId`，
 * 替换 `/` 等路径非法字符（IACR 的 paper_id 含斜杠，如 2026/1331）。
 */
export function sanitizeStorageId(source: string, sourceId: string): string {
  const src = source.toLowerCase();
  if (src === 'arxiv') return sourceId;
  const safe = sourceId
    .replace(/[/\\?#&:<>"|*\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return `${src}-${safe || 'unknown'}`;
}

/** 从 meta.source（如 `arxiv-auto` / `openalex-auto`）解析实际来源数据库。 */
export function parseSourceFromMeta(source?: string): string {
  if (!source) return 'manual';
  return source.endsWith('-auto') ? source.slice(0, -'-auto'.length) : source;
}

export function sourceLabel(source: string): string {
  return SOURCE_INFO[source]?.label ?? source;
}
