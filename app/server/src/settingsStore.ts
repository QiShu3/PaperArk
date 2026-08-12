import fs from 'node:fs';
import path from 'node:path';
import { PAPERS_ROOT } from './paths.js';
import { ALL_KNOWN_SOURCES, SOURCE_INFO } from './sources.js';

const SETTINGS_FILE = path.join(PAPERS_ROOT, 'settings.json');

export interface SourceSetting {
  enabled: boolean;
  key?: string;
}

export interface LLMProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
}

export interface AppSettings {
  providers: LLMProvider[];
  activeProviderId: string;
  model: string;
  mineruToken: string;
  sciverseToken: string;
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

const DEEPSEEK_URL = 'https://api.deepseek.com/v1';

const defaults: AppSettings = {
  providers: [
    { id: 'deepseek', name: 'DeepSeek', apiKey: '', baseUrl: DEEPSEEK_URL },
  ],
  activeProviderId: 'deepseek',
  model: 'v4-flash',
  mineruToken: '',
  sciverseToken: '',
  sources: {},
};

export function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return DEEPSEEK_URL;
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

function sanitizeProviderId(raw: unknown, seen: Set<string>): string {
  const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const clean = id.replace(/[^a-z0-9_-]/g, '-') || `provider-${seen.size + 1}`;
  let out = clean;
  let n = 2;
  while (seen.has(out)) {
    out = `${clean}-${n++}`;
  }
  seen.add(out);
  return out;
}

function readProviders(raw: unknown, legacy: { apiKey?: unknown; baseUrl?: unknown }): LLMProvider[] {
  const seen = new Set<string>();
  const providers: LLMProvider[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      const id = sanitizeProviderId(p.id, seen);
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : id;
      const apiKey = typeof p.apiKey === 'string' ? p.apiKey : '';
      const baseUrl = normalizeBaseUrl(p.baseUrl);
      providers.push({ id, name, apiKey, baseUrl });
    }
  }
  // 旧配置迁移：有 apiKey 但没有 providers 时，生成默认 DeepSeek provider
  if (providers.length === 0) {
    const legacyKey = typeof legacy.apiKey === 'string' ? legacy.apiKey : '';
    const legacyUrl = normalizeBaseUrl(legacy.baseUrl);
    providers.push({
      id: 'deepseek',
      name: 'DeepSeek',
      apiKey: legacyKey,
      baseUrl: legacyUrl,
    });
  }
  return providers;
}

export function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const providers = readProviders(parsed.providers, parsed);
    let activeProviderId = typeof parsed.activeProviderId === 'string' ? parsed.activeProviderId : '';
    if (!providers.some((p) => p.id === activeProviderId)) {
      activeProviderId = providers[0]?.id ?? '';
    }
    return {
      providers,
      activeProviderId,
      model: typeof parsed.model === 'string' ? parsed.model : defaults.model,
      mineruToken: typeof parsed.mineruToken === 'string' ? parsed.mineruToken : defaults.mineruToken,
      sciverseToken: typeof parsed.sciverseToken === 'string' ? parsed.sciverseToken : defaults.sciverseToken,
      sources: readSources(parsed.sources),
    };
  } catch {
    return {
      providers: structuredClone(defaults.providers),
      activeProviderId: defaults.activeProviderId,
      model: defaults.model,
      mineruToken: defaults.mineruToken,
      sciverseToken: defaults.sciverseToken,
      sources: defaultSources(),
    };
  }
}

export function getActiveProvider(settings: AppSettings): LLMProvider {
  return (
    settings.providers.find((p) => p.id === settings.activeProviderId) ??
    settings.providers[0] ?? {
      id: 'deepseek',
      name: 'DeepSeek',
      apiKey: '',
      baseUrl: DEEPSEEK_URL,
    }
  );
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

function mergeProvidersInput(
  current: LLMProvider[],
  input: unknown,
): { providers: LLMProvider[]; activeProviderId: string } {
  const currentActive = readSettings().activeProviderId;
  if (!Array.isArray(input) || input.length === 0) {
    return { providers: current, activeProviderId: currentActive };
  }
  const seen = new Set<string>();
  const providers: LLMProvider[] = [];
  let activeProviderId = currentActive;
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    const id = sanitizeProviderId(p.id, seen);
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : id;
    const apiKey = typeof p.apiKey === 'string' ? p.apiKey : '';
    const baseUrl = normalizeBaseUrl(p.baseUrl);
    if (id === currentActive) activeProviderId = id;
    providers.push({ id, name, apiKey, baseUrl });
  }
  if (!providers.some((p) => p.id === activeProviderId)) {
    activeProviderId = providers[0]?.id ?? '';
  }
  return { providers, activeProviderId };
}

export function writeSettings(settings: {
  providers?: unknown;
  activeProviderId?: string;
  model?: string;
  mineruToken?: string;
  sciverseToken?: string;
  sources?: unknown;
}): AppSettings {
  const current = readSettings();
  const merged = mergeProvidersInput(current.providers, settings.providers);
  const next: AppSettings = {
    providers: merged.providers,
    activeProviderId:
      typeof settings.activeProviderId === 'string' &&
      merged.providers.some((p) => p.id === settings.activeProviderId)
        ? settings.activeProviderId
        : merged.activeProviderId,
    model: settings.model || current.model || defaults.model,
    mineruToken: settings.mineruToken ?? current.mineruToken,
    sciverseToken: settings.sciverseToken ?? current.sciverseToken,
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
