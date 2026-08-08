import { listMdIds } from './indexMd.js';
import { readMeta, writeMeta } from './meta.js';
import { readResearchConfig } from './researchConfig.js';
import { readSettings } from './settingsStore.js';
import { getRawMarkdown } from './store.js';
import { logger } from './logger.js';

const ABSTRACT_RE = /^(#{1,4}\s+)?(\*\*)?Abstract(\*\*)?[.\-\—:]?(\*\*)?\s*/im;
const CLASSIFY_MODEL = process.env.CLASSIFY_MODEL || 'v4-flash';

export interface ClassifyStatus {
  running: boolean;
  current: number;
  total: number;
  matched: number;
  failed: number;
  errors: string[];
}

let classifying = false;
let classifyStatus: ClassifyStatus = {
  running: false,
  current: 0,
  total: 0,
  matched: 0,
  failed: 0,
  errors: [],
};

export function getClassifyStatus(): ClassifyStatus {
  return { ...classifyStatus, errors: [...classifyStatus.errors] };
}

export function extractTitleAndAbstract(md: string): { title: string; abstract: string } {
  const lines = md.split('\n');
  let title = '';
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)/);
    if (m) {
      title = m[1].trim();
      break;
    }
  }
  const abstractMatch = md.match(ABSTRACT_RE);
  let abstract = '';
  if (abstractMatch?.index !== undefined) {
    const rest = md.slice(abstractMatch.index + abstractMatch[0].length);
    abstract = rest
      .split(/^##\s/m)[0]
      .trim()
      .replace(/\n{3,}/g, '\n\n');
  }
  return { title, abstract };
}

export async function classifyTitleAbstract(
  title: string,
  abstract: string,
  directions: string[],
  apiKey: string,
  baseUrl = 'https://api.deepseek.com/v1',
): Promise<string[]> {
  if (directions.length === 0) return [];
  const prompt = `你是论文研究方向分类器。请判断下面这篇论文属于以下哪些研究方向（可多选，也可以一个都不选）。

研究方向列表：
${directions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

标题：${title}
摘要：${abstract}

只返回 JSON，格式为 {"directions": ["研究方向完整名称"]}，名称必须严格来自上面的列表，不要解释。`;

  const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CLASSIFY_MODEL === 'v4-pro' ? 'deepseek-v4-pro' : 'deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`分类请求失败 (HTTP ${resp.status})`);

  const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '';
  const names: string[] = [];
  try {
    const parsed = JSON.parse(content) as { directions?: unknown };
    if (Array.isArray(parsed.directions)) {
      for (const item of parsed.directions) {
        if (typeof item === 'string') names.push(item.trim());
      }
    }
  } catch {
    // fallback: extract quoted strings that exactly match known directions
    for (const d of directions) {
      if (content.includes(`"${d}"`)) names.push(d);
    }
  }
  return [...new Set(names.filter((n) => directions.includes(n)))];
}

export async function classifyPaperById(id: string): Promise<string[]> {
  const md = getRawMarkdown(id);
  const { title, abstract } = extractTitleAndAbstract(md);
  const settings = readSettings();
  const cfg = readResearchConfig();
  const directionNames = cfg.directions.map((d) => d.name);
  if (!settings.apiKey || directionNames.length === 0) return [];
  return classifyTitleAbstract(title, abstract, directionNames, settings.apiKey, settings.baseUrl);
}

export function classifyLibrary(): Promise<void> {
  if (classifying) throw new Error('已有分类任务正在进行');
  const settings = readSettings();
  if (!settings.apiKey) throw new Error('请先在设置中配置 API Key');
  const cfg = readResearchConfig();
  const directionNames = cfg.directions.map((d) => d.name);
  if (directionNames.length === 0) throw new Error('还没有研究方向，请先新增方向');
  return runClassify(directionNames, settings.apiKey);
}

async function runClassify(directionNames: string[], apiKey: string): Promise<void> {
  const ids = listMdIds().sort();
  classifyStatus = {
    running: true,
    current: 0,
    total: ids.length,
    matched: 0,
    failed: 0,
    errors: [],
  };
  classifying = true;
  try {
    for (const id of ids) {
      const existing = readMeta()[id]?.directions ?? [];
      if (existing.length > 0) {
        classifyStatus.current += 1;
        continue;
      }
      try {
        const md = getRawMarkdown(id);
        const { title, abstract } = extractTitleAndAbstract(md);
        const result = await classifyTitleAbstract(
          title,
          abstract,
          directionNames,
          apiKey,
          readSettings().baseUrl,
        );
        const meta = readMeta();
        meta[id] = { ...(meta[id] ?? { tags: [] }), directions: result };
        writeMeta(meta);
        if (result.length > 0) classifyStatus.matched += 1;
      } catch (e) {
        classifyStatus.failed += 1;
        classifyStatus.errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
        logger.warn({ err: e, paperId: id }, 'paper classification failed');
      }
      classifyStatus.current += 1;
    }
  } finally {
    classifyStatus.running = false;
    classifying = false;
  }
}
