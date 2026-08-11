/**
 * 论文源统一定义：源标识、展示名、下载能力、说明、可选 API key 环境变量、默认启停。
 *
 * download=false 的源（如 openalex）只做元数据发现 + DOI 回填，
 * 不保证能拿到 PDF，靠条目自带 pdf_url 或 OA 回退链碰运气。
 *
 * keyEnv：该源若需要 API key，对应 paper-search-mcp 读取的环境变量名；
 * 用户在设置界面填写的 key 会透传为这个环境变量给 MCP 子进程。
 */
export interface SourceInfo {
  label: string;
  download: boolean;
  note?: string;
  keyEnv?: string;
  keyLabel?: string;
  defaultEnabled: boolean;
}

export const SOURCE_INFO: Record<string, SourceInfo> = {
  arxiv: {
    label: 'arXiv',
    download: true,
    note: '预印本与正式版，无需 API key',
    defaultEnabled: true,
  },
  openalex: {
    label: 'OpenAlex',
    download: false,
    note: '元数据发现 + DOI 回填；PDF 走 OA 直链下载',
    defaultEnabled: true,
  },
  iacr: {
    label: 'IACR',
    download: true,
    note: '密码学 ePrint 预印本',
    defaultEnabled: true,
  },
  semantic: {
    label: 'Semantic Scholar',
    download: true,
    keyEnv: 'PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY',
    keyLabel: 'Semantic Scholar API Key',
    note: '免费 key 可提升限流，未配置时常因匿名限流返回空',
    defaultEnabled: false,
  },
  zenodo: {
    label: 'Zenodo',
    download: true,
    note: '上游 MCP 0.1.4 有日期解析 bug，暂缓启用',
    defaultEnabled: false,
  },
};

export const ALL_KNOWN_SOURCES: string[] = Object.keys(SOURCE_INFO);

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
