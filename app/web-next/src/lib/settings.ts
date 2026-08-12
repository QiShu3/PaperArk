import type { Settings, LLMProvider } from '@/types';
import { api } from '@/api';

const KEY = 'papers-settings';
export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

export function defaultProviders(): LLMProvider[] {
  return [{ id: 'deepseek', name: 'DeepSeek', apiKey: '', baseUrl: DEFAULT_BASE_URL }];
}

/** 返回当前激活的 Provider（无 providers 时兜底默认 DeepSeek）。 */
export function activeProvider(s: Settings): LLMProvider {
  return (
    s.providers.find((p) => p.id === s.activeProviderId) ??
    s.providers[0] ??
    defaultProviders()[0]
  );
}

export function getSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const providers = Array.isArray(raw.providers) && raw.providers.length > 0 ? raw.providers : defaultProviders();
    const activeProviderId =
      typeof raw.activeProviderId === 'string' && providers.some((p: LLMProvider) => p.id === raw.activeProviderId)
        ? raw.activeProviderId
        : providers[0].id;
    return {
      providers,
      activeProviderId,
      model: raw.model || 'v4-flash',
      mineruToken: raw.mineruToken || '',
      sources: raw.sources ?? [],
    };
  } catch {
    return { providers: defaultProviders(), activeProviderId: 'deepseek', model: 'v4-flash', mineruToken: '', sources: [] };
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
