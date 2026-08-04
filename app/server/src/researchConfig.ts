import fs from 'node:fs';
import path from 'node:path';
import { PAPERS_ROOT } from './paths.js';

export const RESEARCH_CONFIG_FILE = path.join(PAPERS_ROOT, 'research.json');

export interface ResearchDirection {
  name: string;
  query: string;
  enabled: boolean;
  maxPerRun?: number;
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
      query: 'abs:"diffusion model" AND abs:adversarial AND abs:attack',
      enabled: true,
    },
  ],
};

function clampPositiveInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN;
  return Number.isNaN(n) || n < 1 ? fallback : n;
}

function normalizeDirection(raw: unknown, seen: Set<string>): ResearchDirection | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  const query = typeof d.query === 'string' ? d.query.trim() : '';
  if (!name || !query) return null;
  if (seen.has(name)) return null;
  seen.add(name);
  return {
    name,
    query,
    enabled: d.enabled !== false,
    maxPerRun: d.maxPerRun === undefined ? undefined : clampPositiveInt(d.maxPerRun, 1),
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

export function addDirection(input: {
  name?: unknown;
  query?: unknown;
  enabled?: unknown;
  maxPerRun?: unknown;
}): ResearchDirection {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!name || !query) throw new Error('名称和查询词不能为空');
  const cfg = readResearchConfig();
  if (cfg.directions.some((d) => d.name === name)) throw new Error('研究方向已存在');
  const dir: ResearchDirection = {
    name,
    query,
    enabled: input.enabled !== false,
    maxPerRun: input.maxPerRun === undefined ? undefined : clampPositiveInt(input.maxPerRun, 1),
  };
  cfg.directions.push(dir);
  writeResearchConfig(cfg);
  return dir;
}

export function updateDirection(
  name: string,
  patch: { query?: unknown; enabled?: unknown; maxPerRun?: unknown },
): ResearchDirection | null {
  const cfg = readResearchConfig();
  const dir = cfg.directions.find((d) => d.name === name);
  if (!dir) return null;
  if (patch.query !== undefined) {
    const query = typeof patch.query === 'string' ? patch.query.trim() : '';
    if (!query) throw new Error('查询词不能为空');
    dir.query = query;
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
