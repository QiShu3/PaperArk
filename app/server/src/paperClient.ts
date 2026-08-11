import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { PaperEntry } from './sources.js';
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

/** paper-search-mcp 返回的单个论文记录（search_papers 的 papers 元素）。 */
interface PaperHit {
  paper_id?: string;
  title?: string;
  abstract?: string;
  authors?: string;
  published_date?: string;
  updated_date?: string;
  url?: string;
  categories?: string;
  doi?: string;
  source?: string;
  pdf_url?: string;
}

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let connecting: Promise<Client> | null = null;

/** MCP 通道总开关（默认开启；PAPER_SEARCH_MCP_DISABLED=1 关闭走 arXiv 直连降级）。 */
export function paperSearchMcpEnabled(): boolean {
  return process.env.PAPER_SEARCH_MCP_DISABLED !== '1';
}

function serverParams(): StdioServerParameters {
  const command = process.env.PAPER_SEARCH_MCP_CMD || 'uvx';
  const rawArgs = process.env.PAPER_SEARCH_MCP_ARGS || 'paper-search-mcp';
  return { command, args: rawArgs.split(/\s+/).filter(Boolean), stderr: 'pipe' };
}

async function connect(): Promise<Client> {
  const params = serverParams();
  const t = new StdioClientTransport(params);
  const c = new Client({ name: 'papers-server', version: '0.1.0' });
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
      throw new Error(text || `MCP tool ${name} 执行失败`);
    }
    if (res.structuredContent !== undefined) {
      return { text: '', structured: res.structuredContent };
    }
    const text = Array.isArray(res.content)
      ? res.content.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n')
      : '';
    return { text };
  } catch (err) {
    // 进程级错误（子进程退出/超时）需要重建连接；工具级错误不走到这里。
    await resetClient();
    throw err;
  }
}

/**
 * FastMCP 会把函数返回值包在 structuredContent.result 里
 * （例如 `{ result: { papers: [...] } }`），这里统一解包一层。
 */
function unwrapResult(value: unknown): unknown {
  if (value && typeof value === 'object' && 'result' in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).result;
  }
  return value;
}

/** MCP 返回的 authors / categories 是分号串（如 "A; B; C"）。 */
function splitList(v?: string): string[] {
  if (!v) return [];
  return v
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 源内 ID：arxiv 优先取版本化 ID（兼容 download 用）；其他源取 paper_id。 */
function hitSourceId(h: PaperHit, source: string): string {
  const raw = h.paper_id ?? '';
  if (source === 'arxiv') {
    const m = /^([^/]+)\/abs\/([^?#]+)/.exec(h.url ?? '');
    const fromUrl = m ? m[2] : '';
    return fromUrl || raw || '';
  }
  return raw;
}

function hitToPaperEntry(h: PaperHit, source: string): PaperEntry {
  const sourceId = hitSourceId(h, source);
  const paperId = h.paper_id ?? '';
  return {
    source,
    sourceId,
    arxivId: source === 'arxiv' ? paperId || sourceId : undefined,
    title: h.title ?? '',
    summary: h.abstract ?? '',
    published: h.published_date ?? '',
    authors: splitList(h.authors),
    categories: splitList(h.categories),
    doi: h.doi ?? undefined,
    pdfUrl: h.pdf_url || undefined,
  };
}

/**
 * 通过 paper-search-mcp 的 search_papers 搜索指定源（单源调用，
 * 因为各源查询语法不同）。返回统一的 PaperEntry 列表。
 */
export async function searchEntries(query: string, source: string, maxResults: number): Promise<PaperEntry[]> {
  const { text, structured } = await callTool('search_papers', {
    query,
    sources: source,
    max_results_per_source: Math.max(1, maxResults),
  });
  const data = unwrapResult(structured ?? JSON.parse(text)) as { papers?: PaperHit[] };
  const papers = Array.isArray(data.papers) ? data.papers : [];
  return papers.map((h) => hitToPaperEntry(h, source));
}

/**
 * 通过 paper-search-mcp 的 download_with_fallback 下载 PDF：
 * 源站 → OpenAIRE/CORE/EuropePMC/PMC → Unpaywall（Sci-Hub 显式关闭）。
 * 返回落盘后的绝对路径；MCP 侧无文件/明确失败时抛错。
 */
export async function downloadWithFallback(opts: {
  source: string;
  paperId: string;
  doi?: string;
  title?: string;
  savePath: string;
}): Promise<string> {
  const { text, structured } = await callTool('download_with_fallback', {
    source: opts.source,
    paper_id: opts.paperId,
    doi: opts.doi ?? '',
    title: opts.title ?? '',
    save_path: opts.savePath,
    use_scihub: false,
  });
  const pathStr = String(unwrapResult(structured !== undefined ? structured : text)).trim();
  if (!pathStr || pathStr.startsWith('Download failed')) {
    throw new Error(pathStr || `MCP 下载失败: ${opts.source}/${opts.paperId}`);
  }
  if (!fs.existsSync(pathStr)) {
    throw new Error(`MCP 下载未生成文件: ${pathStr}`);
  }
  return pathStr;
}

/**
 * 直连下载条目自带的 pdf_url（OpenAlex 等元数据源的主路径），
 * 带 %PDF magic 校验。成功返回 Buffer，失败抛错。
 */
export async function fetchPdfUrl(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(120_000),
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; papers-research/0.1)' },
  });
  if (!res.ok) throw new Error(`PDF 直连失败 (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') throw new Error('直连内容不是 PDF');
  return buf;
}

/** 服务器退出时关闭 MCP 子进程。 */
export async function closePaperClient(): Promise<void> {
  await resetClient();
  logger.info('paper-search MCP client closed');
}
