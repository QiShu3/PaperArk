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
  directions?: string[];
  hasMd: boolean;
  hasPdf: boolean;
}

export interface PaperDetail extends Paper {
  markdown: string;
}

export interface SearchResult extends Paper {
  snippet: string;
}

export interface TagCount {
  tag: string;
  count: number;
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

export interface Settings {
  apiKey: string;
  model: string;
  baseUrl?: string;
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
