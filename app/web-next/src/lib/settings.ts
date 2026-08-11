import type { Settings } from '@/types';
import { api } from '@/api';

const KEY = 'papers-settings';
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

export function getSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      apiKey: raw.apiKey || '',
      model: raw.model || 'v4-flash',
      baseUrl: raw.baseUrl || DEFAULT_BASE_URL,
      sources: raw.sources ?? [],
    };
  } catch {
    return { apiKey: '', model: 'v4-flash', baseUrl: DEFAULT_BASE_URL, sources: [] };
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    return await api.getSettings();
  } catch {
    return getSettings();
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  api.saveSettings(s).catch(() => {});
}
