export interface Paper {
  id: string;
  title: string;
  tags: string[];
  notes?: string;
  addedAt?: string;
  venue?: string;
  year?: string;
  area?: string;
  source?: string;
  sourceId?: string;
  doi?: string;
  externalUrl?: string;
  directions?: string[];
  authors?: string[];
  abstract?: string;
  hasMd: boolean;
  hasPdf: boolean;
}

export interface PaperDetail extends Paper {
  markdown: string;
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

export interface EnrichResult {
  id: string;
  title: string;
  source: string;
  updated: boolean;
  changes: {
    doi?: string;
    venue?: string;
    year?: string;
    authors?: string[];
    abstract?: string;
  };
}

export interface SearchResult extends Paper {
  snippet: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** 跨论文浏览分区（与 server 端 sections.ts 保持一致）。 */
export type SectionCategory =
  | 'abstract'
  | 'introduction'
  | 'related'
  | 'method'
  | 'experiments'
  | 'conclusion'
  | 'other';

export interface SectionInfo {
  chunkIndex: number;
  heading: string;
  charCount: number;
  images: string[];
  /** 该分区全部 chunk 索引（含编号子节，按正文顺序），用于拼接完整内容 */
  chunkIndexes: number[];
}

export interface OverviewEntry {
  paperId: string;
  title: string;
  year?: string;
  /** 是否存在 MD 中文翻译（md-translations/<id>.zh.md） */
  hasZh: boolean;
  sections: Partial<Record<SectionCategory, SectionInfo>>;
}

export interface OverviewResponse {
  papers: OverviewEntry[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface SourceSetting {
  source: string;
  label: string;
  download: boolean;
  note?: string;
  keyEnv?: string;
  keyLabel?: string;
  enabled: boolean;
  hasKey: boolean;
  key?: string;
}

export interface LLMProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
}

export interface Settings {
  providers: LLMProvider[];
  activeProviderId: string;
  model: string;
  mineruToken?: string;
  sciverseToken?: string;
  sources?: SourceSetting[];
}

export interface ChatSession {
  id: string;
  paper_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export type ErrorCode =
  | 'AUTH_MISSING'
  | 'AUTH_INVALID'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'STREAM_ERROR'
  | 'STREAM_PARSE'
  | 'TOOL_EXECUTION'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_ARGS_PARSE'
  | 'DB_ERROR'
  | 'FS_ERROR'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'INTERNAL';

export type ErrorSeverity = 'fatal' | 'error' | 'warn';

export interface AppError {
  code: ErrorCode;
  severity: ErrorSeverity;
  message: string;
  userMessage: string;
  retryable: boolean;
  context?: Record<string, unknown>;
}

export const USER_MESSAGES: Record<ErrorCode, string> = {
  AUTH_MISSING: '请先在设置中配置 API Key',
  AUTH_INVALID: 'API Key 无效，请检查设置',
  UPSTREAM_ERROR: 'AI 服务返回错误，请稍后重试',
  TIMEOUT: 'AI 服务超时，请稍后重试',
  STREAM_ERROR: '连接中断，请重试',
  STREAM_PARSE: '数据解析异常，请重试',
  TOOL_EXECUTION: '工具执行失败',
  TOOL_NOT_FOUND: '未知的工具调用',
  TOOL_ARGS_PARSE: '工具参数解析失败',
  DB_ERROR: '数据存储异常',
  FS_ERROR: '文件读取异常',
  VALIDATION: '请求参数无效',
  NOT_FOUND: '资源不存在',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  INTERNAL: '服务器内部错误',
};

export interface ChunkRow {
  id: number;
  chunk_index: number;
  heading: string;
  heading_level: number;
  parent_id: number | null;
  content: string;
  char_count: number;
}

export interface ResearchQuery {
  source: string;
  query: string;
}

export interface ResearchDirection {
  name: string;
  enabled: boolean;
  maxPerRun?: number;
  queries: ResearchQuery[];
}

export interface ResearchConfigDto {
  schedule: { cron: string; timezone: string };
  maxPerRun: number;
  directions: ResearchDirection[];
  availableSources?: { source: string; label: string; download: boolean }[];
}

export type ResearchPaperStatus =
  | 'added'
  | 'duplicate'
  | 'download_failed'
  | 'parse_failed'
  | 'previously_failed';

export interface ResearchRunPaper {
  id: string;
  source: string;
  arxivId: string;
  title: string;
  status: ResearchPaperStatus;
  error?: string;
}

export interface ResearchRunDirection {
  direction: string;
  query: string;
  papers: ResearchRunPaper[];
  error?: string;
}

export interface ResearchRun {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success';
  directions: ResearchRunDirection[];
}

export interface ClassifyStatus {
  running: boolean;
  current: number;
  total: number;
  matched: number;
  failed: number;
  errors: string[];
}

export type MdTranslationStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface MdTranslationRecord {
  paperId: string;
  status: MdTranslationStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  progress?: { done: number; total: number };
  content?: string;
}

export interface SemanticHit {
  paperId: string;
  chunkIndex: number;
  heading: string;
  content: string;
  score: number;
}

export interface EmbedStatus {
  enabled: boolean;
  running: boolean;
  current: number;
  total: number;
  embedded: number;
}

export interface SciverseSemanticHit {
  doc_id?: string;
  chunk_id?: string;
  text?: string;
  score?: number;
  title?: string;
  abstract?: string;
  source?: { title?: string; year?: number; venue?: string; authors?: string[] };
  offset?: number;
  page_no?: number;
  citation_count?: number;
}

export interface SciversePaperHit {
  doc_id?: string;
  unique_id?: string;
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  is_content_accessible?: boolean;
  citation_count?: number;
}

export interface SciverseContentSlice {
  text: string;
  next_offset: number;
  more: boolean;
}

export interface SciverseRelationItem {
  id?: string;
  id_type?: string;
  title?: string;
}

export interface SciverseFavorite {
  doc_id: string;
  unique_id?: string;
  title: string;
  authors: string[];
  year?: string;
  venue?: string;
  abstract?: string;
  doi?: string;
  externalUrl?: string;
  addedAt: string;
}

export interface SciverseStatus {
  enabled: boolean;
  tokenConfigured: boolean;
}

export interface PromoteResult {
  status: 'added' | 'duplicate';
  paper: Paper;
  error?: string;
}
