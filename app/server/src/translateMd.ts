import fs from 'node:fs';
import path from 'node:path';
import { PAPERS_ROOT, MD_TRANSLATION_DIR } from './paths.js';
import { readSettings } from './settingsStore.js';
import { getRawMarkdown } from './store.js';
import { logger } from './logger.js';

export type MdTranslationStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface MdTranslationRecord {
  paperId: string;
  status: MdTranslationStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  progress?: { done: number; total: number };
}

const INDEX_FILE = path.join(PAPERS_ROOT, 'md-translations.json');
const BATCH_CHAR_LIMIT = 2800;
const TIMEOUT_MS = 60_000;

export function resolveModel(model: string): string {
  if (model === 'v4-pro') return 'deepseek-v4-pro';
  return 'deepseek-v4-flash';
}

const SYSTEM_PROMPT = `你是一名专业的学术论文翻译引擎。把用户提供的英文 Markdown 翻译成简体中文。
要求：
1. 保留所有 Markdown 语法：标题层级（#）、表格、列表、链接、图片引用 ![..](..)、代码块。
2. 保留所有 LaTeX 公式（$...$、$$...$$）与行内数学符号，公式内容一律不改。
3. 保留引用编号（如 [1]、[12]）与 arXiv/DOI 编号。
4. 术语首次出现时可在中文后附英文原文，例如：扩散模型（Diffusion Model）。
5. 只输出翻译后的 Markdown 内容，不要输出任何解释、前言或代码围栏。`;

const jobs = new Map<string, { controller: AbortController; record: MdTranslationRecord }>();
let activeCount = 0;

function readIndex(): Record<string, MdTranslationRecord> {
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeIndex(index: Record<string, MdTranslationRecord>): void {
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2) + '\n', 'utf-8');
}

function persist(record: MdTranslationRecord): void {
  const index = readIndex();
  index[record.paperId] = record;
  writeIndex(index);
}

export function outputPath(paperId: string): string {
  return path.join(MD_TRANSLATION_DIR, `${paperId}.zh.md`);
}

export function getMdTranslationStatus(paperId: string): MdTranslationRecord {
  const job = jobs.get(paperId);
  if (job) return { ...job.record };
  const index = readIndex();
  const record = index[paperId];
  if (record) {
    // 磁盘兜底：译文文件存在即视为完成
    if (record.status !== 'done' && fs.existsSync(outputPath(paperId))) {
      const done: MdTranslationRecord = {
        ...record,
        status: 'done',
        finishedAt: record.finishedAt ?? new Date().toISOString(),
        error: undefined,
      };
      persist(done);
      return done;
    }
    if (record.status === 'running') {
      const stale: MdTranslationRecord = {
        ...record,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: '翻译任务已中断（服务器重启），请重新翻译',
      };
      persist(stale);
      return stale;
    }
    return record;
  }
  return fs.existsSync(outputPath(paperId))
    ? { paperId, status: 'done' }
    : { paperId, status: 'idle' };
}

/** 按标题分段，保留标题文本 */
export function splitSections(md: string): string[] {
  const sections: string[] = [];
  let current = '';
  for (const line of md.split('\n')) {
    if (/^#{1,6}\s+/.test(line)) {
      if (current.trim()) sections.push(current.trim());
      current = line;
    } else {
      current += '\n' + line;
    }
  }
  if (current.trim()) sections.push(current.trim());
  return sections.filter(Boolean);
}

/** 把段落按字符数限制分批；不在公式/代码块中间断开 */
export function buildBatches(sections: string[], limit = BATCH_CHAR_LIMIT): string[] {
  const batches: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) batches.push(current.trim());
    current = '';
  };

  const closeEnough = (s: string): boolean => {
    const fences = (s.match(/```/g) ?? []).length;
    const dollars = (s.match(/\$\$/g) ?? []).length;
    return fences % 2 === 0 && dollars % 2 === 0;
  };

  for (const section of sections) {
    const paragraphs = section.split(/\n{2,}/);
    for (const para of paragraphs) {
      const candidate = current ? current + '\n\n' + para : para;
      if (candidate.length > limit && current && closeEnough(current)) {
        push();
        current = para;
      } else {
        current = candidate;
      }
    }
  }
  if (current) push();

  // 极长的单段落（例如整块代码）强制拆分
  const result: string[] = [];
  for (const b of batches) {
    if (b.length <= limit * 1.5) {
      result.push(b);
    } else {
      for (let i = 0; i < b.length; i += limit) {
        result.push(b.slice(i, i + limit));
      }
    }
  }
  return result;
}

async function doTranslate(
  content: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    temperature: 0.2,
    max_tokens: 4096,
    stream: false,
  };
  // 关闭思考可显著提速并节省 token（仅对支持的中转/模型生效，不支持的会忽略）
  if (process.env.MD_TRANSLATE_THINKING !== 'enabled') {
    body.thinking = { type: 'disabled' };
  }
  const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`翻译请求失败 (HTTP ${resp.status})${text ? `：${text.slice(0, 200)}` : ''}`);
  }
  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const contentOut = data.choices?.[0]?.message?.content ?? '';
  if (!contentOut.trim()) throw new Error('翻译接口返回空内容');
  return contentOut.trim();
}

async function translateBatch(
  content: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  signal: AbortSignal,
): Promise<string> {
  // 中转站偶发空响应/限流，最多重试 3 次（取消除外）
  let lastError: unknown = new Error('翻译失败');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1200 * attempt));
    try {
      return await doTranslate(content, apiKey, baseUrl, model, signal);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      lastError = e;
    }
  }
  throw lastError;
}

async function runJob(paperId: string): Promise<void> {
  const settings = readSettings();
  if (!settings.apiKey) throw new Error('请先在设置中配置 API Key');

  const md = getRawMarkdown(paperId);
  if (!md.trim()) throw new Error('论文没有 Markdown 内容');
  const batches = buildBatches(splitSections(md));
  if (batches.length === 0) throw new Error('论文 Markdown 为空');

  const controller = new AbortController();
  const record: MdTranslationRecord = {
    paperId,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { done: 0, total: batches.length },
  };
  persist(record);
  jobs.set(paperId, { controller, record });
  activeCount++;

  const model = resolveModel(settings.model || 'v4-flash');
  const baseUrl = settings.baseUrl || 'https://api.deepseek.com/v1';
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS * Math.max(1, batches.length));
  timer.unref?.();

  try {
    const parts: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      const translated = await translateBatch(batches[i], settings.apiKey, baseUrl, model, controller.signal);
      parts.push(translated);
      const job = jobs.get(paperId);
      if (!job) return; // 已取消
      job.record.progress = { done: i + 1, total: batches.length };
      persist(job.record);
    }
    const out = outputPath(paperId);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, parts.join('\n\n') + '\n', 'utf-8');
    const done: MdTranslationRecord = {
      paperId,
      status: 'done',
      startedAt: record.startedAt,
      finishedAt: new Date().toISOString(),
      progress: { done: batches.length, total: batches.length },
    };
    persist(done);
  } finally {
    clearTimeout(timer);
    jobs.delete(paperId);
    activeCount = Math.max(0, activeCount - 1);
  }
}

export function startMdTranslation(paperId: string): MdTranslationRecord {
  const existing = getMdTranslationStatus(paperId);
  if (existing.status === 'done') return existing;
  if (existing.status === 'running') return existing;
  if (activeCount > 0) throw new Error('已有论文正在翻译，请稍候');
  if (jobs.has(paperId)) throw new Error('该论文正在翻译中');

  const paperMd = getRawMarkdown(paperId);
  if (!paperMd.trim()) throw new Error('该论文没有 Markdown 内容');

  void runJob(paperId).catch((e) => {
    const message = e instanceof Error ? e.message : String(e);
    const record: MdTranslationRecord = {
      paperId,
      status: 'failed',
      startedAt: existing.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: message,
    };
    persist(record);
    jobs.delete(paperId);
    activeCount = Math.max(0, activeCount - 1);
    logger.warn({ err: e, paperId }, 'md translation failed');
  });

  return getMdTranslationStatus(paperId);
}

export function cancelMdTranslation(paperId: string): MdTranslationRecord {
  const job = jobs.get(paperId);
  if (!job) return getMdTranslationStatus(paperId);
  job.controller.abort();
  jobs.delete(paperId);
  activeCount = Math.max(0, activeCount - 1);
  const record: MdTranslationRecord = {
    ...job.record,
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
    error: '已取消',
  };
  persist(record);
  return record;
}

export function readMdTranslation(paperId: string): string {
  return fs.existsSync(outputPath(paperId)) ? fs.readFileSync(outputPath(paperId), 'utf-8') : '';
}

export function cleanupMdPaper(paperId: string): void {
  const job = jobs.get(paperId);
  if (job) {
    job.controller.abort();
    jobs.delete(paperId);
    activeCount = Math.max(0, activeCount - 1);
  }
  fs.rmSync(outputPath(paperId), { force: true });
  const index = readIndex();
  if (index[paperId]) {
    delete index[paperId];
    writeIndex(index);
  }
}
