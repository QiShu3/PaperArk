import fs from 'node:fs';
import path from 'node:path';
import { PAPERS_ROOT } from './paths.js';
import { ALL_KNOWN_SOURCES, SOURCE_INFO } from './sources.js';

const SETTINGS_FILE = path.join(PAPERS_ROOT, 'settings.json');

export interface SourceSetting {
  enabled: boolean;
  key?: string;
}

export interface AppSettings {
  apiKey: string;
  model: string;
  baseUrl: string;
  sources: Record<string, SourceSetting>;
}

/** 展示给前端的源视图（不含 key 明文，只含是否已配置）。 */
export interface SourceView {
  source: string;
  label: string;
  download: boolean;
  note?: string;
  keyEnv?: string;
  keyLabel?: string;
  enabled: boolean;
  hasKey: boolean;
}

const defaults: AppSettings = {
  apiKey: '',
  model: 'v4-flash',
  baseUrl: 'https://api.deepseek.com/v1',
  sources: {},
};

export function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return defaults.baseUrl;
  return raw.trim().replace(/\/+$/, '');
}

function defaultSources(): Record<string, SourceSetting> {
  const out: Record<string, SourceSetting> = {};
  for (const src of ALL_KNOWN_SOURCES) {
    out[src] = { enabled: SOURCE_INFO[src]?.defaultEnabled ?? false };
  }
  return out;
}

function readSources(raw: unknown): Record<string, SourceSetting> {
  const out = defaultSources();
  if (raw && typeof raw === 'object') {
    for (const src of ALL_KNOWN_SOURCES) {
      const item = (raw as Record<string, unknown>)[src];
      if (!item || typeof item !== 'object') continue;
      const s = item as Record<string, unknown>;
      const cur = out[src];
      cur.enabled = typeof s.enabled === 'boolean' ? s.enabled : cur.enabled;
      if (typeof s.key === 'string' && s.key.trim()) cur.key = s.key.trim();
    }
  }
  return out;
}

export function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : defaults.apiKey,
      model: typeof parsed.model === 'string' ? parsed.model : defaults.model,
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      sources: readSources(parsed.sources),
    };
  } catch {
    return { ...defaults, sources: defaultSources() };
  }
}

function mergeSourcesInput(
  current: Record<string, SourceSetting>,
  input: unknown,
): Record<string, SourceSetting> {
  const next: Record<string, SourceSetting> = {};
  for (const src of ALL_KNOWN_SOURCES) next[src] = { ...current[src] };
  if (!Array.isArray(input)) return next;
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const src = typeof s.source === 'string' ? s.source : '';
    if (!next[src]) continue;
    if (typeof s.enabled === 'boolean') next[src].enabled = s.enabled;
    if (typeof s.key === 'string' && s.key.trim()) next[src].key = s.key.trim();
  }
  return next;
}

export function writeSettings(settings: {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  sources?: unknown;
}): AppSettings {
  const current = readSettings();
  const next: AppSettings = {
    apiKey: settings.apiKey ?? current.apiKey,
    model: settings.model || current.model || defaults.model,
    baseUrl: normalizeBaseUrl(settings.baseUrl ?? current.baseUrl),
    sources: mergeSourcesInput(current.sources, settings.sources),
  };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  return next;
}

export function sourceViews(settings: AppSettings): SourceView[] {
  return ALL_KNOWN_SOURCES.map((src) => {
    const info = SOURCE_INFO[src];
    const setting = settings.sources[src] ?? { enabled: false };
    return {
      source: src,
      label: info?.label ?? src,
      download: info?.download ?? false,
      note: info?.note,
      keyEnv: info?.keyEnv,
      keyLabel: info?.keyLabel,
      enabled: setting.enabled,
      hasKey: !!setting.key,
    };
  });
}
