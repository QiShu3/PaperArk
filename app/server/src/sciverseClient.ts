import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readSettings } from './settingsStore.js';
import { logger } from './logger.js';

const DEFAULT_TIMEOUT_MS = 120_000;

interface TextBlock {
  type: 'text';
  text: string;
}

interface CallToolOutcome {
  text: string;
  structured?: unknown;
}

/** sciverse-mcp-server 的 semantic_search 命中。 */
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

export interface SciverseSearchPaperHit {
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

export interface SciverseCatalogField {
  name: string;
  type: string;
  filterable?: boolean;
  sortable?: boolean;
  searchable?: boolean;
  default_returned?: boolean;
  description?: string;
  operators?: string[];
  sample_values?: string[];
}

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connecting: Promise<Client> | null = null;

/** MCP 通道总开关（默认开启；SCIVERSE_MCP_DISABLED=1 关闭）。 */
export function sciverseMcpEnabled(): boolean {
  return process.env.SCIVERSE_MCP_DISABLED !== '1';
}

/** 读取 settings 里配置的 Sciverse Token（明文，仅服务端使用）。 */
export function sciverseToken(): string {
  return readSettings().sciverseToken.trim();
}

function serverParams(): StdioServerParameters {
  const command = process.env.SCIVERSE_MCP_CMD || 'npx';
  const rawArgs = process.env.SCIVERSE_MCP_ARGS || '-y sciverse-mcp-server';
  const params: StdioServerParameters = {
    command,
    args: rawArgs.split(/\s+/).filter(Boolean),
    stderr: 'pipe',
  };
  const env: Record<string, string> = {};
  const token = sciverseToken();
  if (token) env.SCIVERSE_API_TOKEN = token;
  if (process.env.SCIVERSE_BASE_URL) env.SCIVERSE_BASE_URL = process.env.SCIVERSE_BASE_URL;
  if (Object.keys(env).length > 0) {
    params.env = Object.assign({}, process.env, env) as Record<string, string>;
  }
  return params;
}

async function connect(): Promise<Client> {
  const params = serverParams();
  const t = new StdioClientTransport(params);
  const c = new Client({ name: 'papers-sciverse-client', version: '0.1.0' });
  await c.connect(t);
  client = c;
  transport = t;
  return c;
}

async function getClient(): Promise<Client> {
  if (client) return client;
  if (!connecting) {
    connecting = connect().catch((err) => {
      connecting = null;
      throw err;
    });
  }
  return connecting;
}

/** 关闭并清空当前连接，下次调用时重新拉起子进程。 */
async function resetClient(): Promise<void> {
  const c = client;
  client = null;
  transport = null;
  connecting = null;
  if (c) await c.close().catch(() => {});
}

async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolOutcome> {
  const c = await getClient();
  try {
    const res = await c.callTool({ name, arguments: args }, undefined, {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    if (res.isError) {
      const text = Array.isArray(res.content)
        ? res.content.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n')
        : '';
      throw new Error(text || `Sciverse MCP tool ${name} 执行失败`);
    }
    if (res.structuredContent !== undefined) {
      return { text: '', structured: res.structuredContent };
    }
    const text = Array.isArray(res.content)
      ? res.content.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n')
      : '';
    return { text };
  } catch (err) {
    await resetClient();
    throw err;
  }
}

/** FastMCP 会把函数返回值包在 structuredContent.result 里，这里统一解包一层。 */
function unwrapResult(value: unknown): unknown {
  if (value && typeof value === 'object' && 'result' in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).result;
  }
  return value;
}

async function callUnwrapped(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { text, structured } = await callTool(name, args);
  const raw = structured ?? text;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return unwrapResult(raw);
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

export async function semanticSearch(
  query: string,
  topK = 10,
  mode = 'balanced',
): Promise<SciverseSemanticHit[]> {
  const data = await callUnwrapped('semantic_search', { query, top_k: topK, mode });
  const hits = (data as { hits?: unknown })?.hits;
  return asArray(hits).map((h) => ({
    doc_id: typeof h.doc_id === 'string' ? h.doc_id : undefined,
    chunk_id: typeof h.chunk_id === 'string' ? h.chunk_id : undefined,
    text: typeof h.text === 'string' ? h.text : undefined,
    score: typeof h.score === 'number' ? h.score : undefined,
    title: typeof h.title === 'string' ? h.title : undefined,
    abstract: typeof h.abstract === 'string' ? h.abstract : undefined,
    source: h.source && typeof h.source === 'object' ? h.source as SciverseSemanticHit['source'] : undefined,
    offset: typeof h.offset === 'number' ? h.offset : undefined,
    page_no: typeof h.page_no === 'number' ? h.page_no : undefined,
    citation_count: typeof h.citation_count === 'number' ? h.citation_count : undefined,
  }));
}

export async function searchPapers(opts: {
  query?: string;
  authors?: string[];
  yearFrom?: number;
  pageSize?: number;
}): Promise<SciverseSearchPaperHit[]> {
  const args: Record<string, unknown> = {};
  if (opts.query) args.query = opts.query;
  if (opts.authors?.length) args.authors = opts.authors;
  if (opts.yearFrom !== undefined) args.year_from = opts.yearFrom;
  if (opts.pageSize !== undefined) args.page_size = opts.pageSize;
  const data = await callUnwrapped('search_papers', args);
  const hits = (data as { hits?: unknown })?.hits;
  return asArray(hits).map((h) => ({
    doc_id: typeof h.doc_id === 'string' ? h.doc_id : undefined,
    unique_id: typeof h.unique_id === 'string' ? h.unique_id : undefined,
    title: typeof h.title === 'string' ? h.title : undefined,
    authors: Array.isArray(h.authors) ? (h.authors as string[]) : undefined,
    year: typeof h.year === 'number' ? h.year : undefined,
    venue: typeof h.venue === 'string' ? h.venue : undefined,
    abstract: typeof h.abstract === 'string' ? h.abstract : undefined,
    doi: typeof h.doi === 'string' ? h.doi : undefined,
    is_content_accessible: typeof h.is_content_accessible === 'boolean' ? h.is_content_accessible : undefined,
    citation_count: typeof h.citation_count === 'number' ? h.citation_count : undefined,
  }));
}

export async function readContent(docId: string, offset = 0, limit = 4096): Promise<SciverseContentSlice> {
  const data = await callUnwrapped('read_content', { doc_id: docId, offset, limit });
  if (data && typeof data === 'object' && typeof (data as Record<string, unknown>).text === 'string') {
    const d = data as Record<string, unknown>;
    return {
      text: d.text as string,
      next_offset: typeof d.next_offset === 'number' ? d.next_offset : offset,
      more: typeof d.more === 'boolean' ? d.more : false,
    };
  }
  return { text: String(data ?? ''), next_offset: offset, more: false };
}

export async function listPaperRelations(
  uniqueId: string,
  relation: 'CITATIONS' | 'REFERENCES' | 'RELATED_WORKS',
  page = 1,
  pageSize = 25,
): Promise<{ items: SciverseRelationItem[]; totalCount: number; page: number; totalPages: number }> {
  const data = await callUnwrapped('list_paper_relations', {
    unique_id: uniqueId,
    relation,
    page,
    page_size: pageSize,
  });
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    items: asArray(d.items).map((it) => ({
      id: typeof it.id === 'string' ? it.id : undefined,
      id_type: typeof it.id_type === 'string' ? it.id_type : undefined,
      title: typeof it.title === 'string' ? it.title : undefined,
    })),
    totalCount: typeof d.total_count === 'number' ? d.total_count : 0,
    page: typeof d.page === 'number' ? d.page : page,
    totalPages: typeof d.total_pages === 'number' ? d.total_pages : 1,
  };
}

export async function getResource(fileName: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const data = await callUnwrapped('get_resource', { file_name: fileName });
  const d = (data ?? {}) as Record<string, unknown>;
  const bytes = d.bytes;
  if (typeof bytes === 'string') {
    return {
      bytes: Buffer.from(bytes, 'base64'),
      mimeType: typeof d.mime_type === 'string' ? d.mime_type : 'application/octet-stream',
    };
  }
  throw new Error(`get_resource 返回内容无法解析 (${fileName})`);
}

export async function listCatalog(includeSampleValues = false): Promise<SciverseCatalogField[]> {
  const data = await callUnwrapped('list_catalog', { include_sample_values: includeSampleValues });
  const fields = (data as { fields?: unknown })?.fields;
  return asArray(fields).map((f) => ({
    name: typeof f.name === 'string' ? f.name : '',
    type: typeof f.type === 'string' ? f.type : 'String',
    filterable: typeof f.filterable === 'boolean' ? f.filterable : undefined,
    sortable: typeof f.sortable === 'boolean' ? f.sortable : undefined,
    searchable: typeof f.searchable === 'boolean' ? f.searchable : undefined,
    default_returned: typeof f.default_returned === 'boolean' ? f.default_returned : undefined,
    description: typeof f.description === 'string' ? f.description : undefined,
    operators: Array.isArray(f.operators) ? (f.operators as string[]) : undefined,
    sample_values: Array.isArray(f.sample_values) ? (f.sample_values as string[]) : undefined,
  }));
}

/** 服务器退出时关闭 MCP 子进程。 */
export async function closeSciverseClient(): Promise<void> {
  await resetClient();
  logger.info('sciverse MCP client closed');
}
