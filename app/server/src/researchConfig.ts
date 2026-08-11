import fs from 'node:fs';
import path from 'node:path';
import { PAPERS_ROOT } from './paths.js';
import { AVAILABLE_SOURCES, SOURCE_INFO } from './sources.js';

export const RESEARCH_CONFIG_FILE = path.join(PAPERS_ROOT, 'research.json');

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

export interface ResearchSchedule {
  cron: string;
  timezone: string;
}

export interface ResearchConfig {
  schedule: ResearchSchedule;
  maxPerRun: number;
  directions: ResearchDirection[];
}

export const DEFAULT_CONFIG: ResearchConfig = {
  schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
  maxPerRun: 5,
  directions: [
    {
      name: '基于扩散模型的对抗攻击',
      enabled: true,
      queries: [
        {
          source: 'arxiv',
          query: 'abs:"diffusion model" AND abs:adversarial AND abs:attack',
        },
      ],
    },
  ],
};

function clampPositiveInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN;
  return Number.isNaN(n) || n < 1 ? fallback : n;
}

function normalizeQueries(raw: unknown): ResearchQuery[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const queries: ResearchQuery[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    const source = typeof q.source === 'string' ? q.source.trim().toLowerCase() : '';
    const query = typeof q.query === 'string' ? q.query.trim() : '';
    if (!source || !query) continue;
    if (!AVAILABLE_SOURCES.includes(source)) continue;
    if (seen.has(source)) continue;
    seen.add(source);
    queries.push({ source, query });
  }
  return queries;
}

function normalizeDirection(raw: unknown, seen: Set<string>): ResearchDirection | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (!name || seen.has(name)) return null;
  seen.add(name);

  // 旧配置兼容：只有单条 query（无 queries 数组）时，视为 arXiv 源查询。
  let queries = normalizeQueries(d.queries);
  if (queries.length === 0 && typeof d.query === 'string' && d.query.trim()) {
    queries = [{ source: 'arxiv', query: d.query.trim() }];
  }
  if (queries.length === 0) return null;

  return {
    name,
    enabled: d.enabled !== false,
    maxPerRun: d.maxPerRun === undefined ? undefined : clampPositiveInt(d.maxPerRun, 1),
    queries,
  };
}

export function readResearchConfig(): ResearchConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(RESEARCH_CONFIG_FILE, 'utf-8')) as Record<string, unknown>;
    const seen = new Set<string>();
    const directions = Array.isArray(raw.directions)
      ? (raw.directions.map((d) => normalizeDirection(d, seen)).filter(Boolean) as ResearchDirection[])
      : DEFAULT_CONFIG.directions;
    const schedule = raw.schedule && typeof raw.schedule === 'object'
      ? {
          cron: typeof (raw.schedule as Record<string, unknown>).cron === 'string'
            ? String((raw.schedule as Record<string, unknown>).cron)
            : DEFAULT_CONFIG.schedule.cron,
          timezone: typeof (raw.schedule as Record<string, unknown>).timezone === 'string'
            ? String((raw.schedule as Record<string, unknown>).timezone)
            : DEFAULT_CONFIG.schedule.timezone,
        }
      : { ...DEFAULT_CONFIG.schedule };
    return {
      schedule,
      maxPerRun: clampPositiveInt(raw.maxPerRun, DEFAULT_CONFIG.maxPerRun),
      directions,
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function writeResearchConfig(config: ResearchConfig): ResearchConfig {
  const seen = new Set<string>();
  const directions = config.directions
    .map((d) => normalizeDirection(d, seen))
    .filter(Boolean) as ResearchDirection[];
  const next: ResearchConfig = {
    schedule: {
      cron: config.schedule.cron || DEFAULT_CONFIG.schedule.cron,
      timezone: config.schedule.timezone || DEFAULT_CONFIG.schedule.timezone,
    },
    maxPerRun: clampPositiveInt(config.maxPerRun, DEFAULT_CONFIG.maxPerRun),
    directions,
  };
  fs.mkdirSync(path.dirname(RESEARCH_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(RESEARCH_CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  return next;
}

function buildQueries(input: { queries?: unknown; query?: unknown }): ResearchQuery[] {
  const fromQueries = normalizeQueries(input.queries);
  if (fromQueries.length > 0) return fromQueries;
  if (typeof input.query === 'string' && input.query.trim()) {
    return [{ source: 'arxiv', query: input.query.trim() }];
  }
  return [];
}

export function addDirection(input: {
  name?: unknown;
  query?: unknown;
  queries?: unknown;
  enabled?: unknown;
  maxPerRun?: unknown;
}): ResearchDirection {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const queries = buildQueries(input);
  if (!name || queries.length === 0) throw new Error('名称和查询词不能为空');
  const cfg = readResearchConfig();
  if (cfg.directions.some((d) => d.name === name)) throw new Error('研究方向已存在');
  const dir: ResearchDirection = {
    name,
    enabled: input.enabled !== false,
    maxPerRun: input.maxPerRun === undefined ? undefined : clampPositiveInt(input.maxPerRun, 1),
    queries,
  };
  cfg.directions.push(dir);
  writeResearchConfig(cfg);
  return dir;
}

export function updateDirection(
  name: string,
  patch: { queries?: unknown; query?: unknown; enabled?: unknown; maxPerRun?: unknown },
): ResearchDirection | null {
  const cfg = readResearchConfig();
  const dir = cfg.directions.find((d) => d.name === name);
  if (!dir) return null;
  if (patch.queries !== undefined || patch.query !== undefined) {
    const queries = buildQueries(patch);
    if (queries.length === 0) throw new Error('查询词不能为空');
    dir.queries = queries;
  }
  if (patch.enabled !== undefined) dir.enabled = patch.enabled !== false;
  if (patch.maxPerRun !== undefined) dir.maxPerRun = clampPositiveInt(patch.maxPerRun, 1);
  writeResearchConfig(cfg);
  return dir;
}

export function deleteDirection(name: string): boolean {
  const cfg = readResearchConfig();
  const idx = cfg.directions.findIndex((d) => d.name === name);
  if (idx === -1) return false;
  cfg.directions.splice(idx, 1);
  writeResearchConfig(cfg);
  return true;
}

export function availableSources(): { source: string; label: string; download: boolean }[] {
  return AVAILABLE_SOURCES.map((s) => ({
    source: s,
    label: SOURCE_INFO[s]?.label ?? s,
    download: SOURCE_INFO[s]?.download ?? false,
  }));
}
