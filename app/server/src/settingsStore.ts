import fs from 'node:fs';
import path from 'node:path';
import { PAPERS_ROOT } from './paths.js';

const SETTINGS_FILE = path.join(PAPERS_ROOT, 'settings.json');

export interface AppSettings {
  apiKey: string;
  model: string;
  baseUrl: string;
}

const defaults: AppSettings = { apiKey: '', model: 'v4-flash', baseUrl: 'https://api.deepseek.com/v1' };

export function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return defaults.baseUrl;
  return raw.trim().replace(/\/+$/, '');
}

export function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : defaults.apiKey,
      model: typeof parsed.model === 'string' ? parsed.model : defaults.model,
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
    };
  } catch {
    return { ...defaults };
  }
}

export function writeSettings(settings: Partial<AppSettings>): AppSettings {
  const current = readSettings();
  const next: AppSettings = {
    apiKey: settings.apiKey ?? current.apiKey,
    model: settings.model || current.model || defaults.model,
    baseUrl: normalizeBaseUrl(settings.baseUrl ?? current.baseUrl),
  };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  return next;
}
