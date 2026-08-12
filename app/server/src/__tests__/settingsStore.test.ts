import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;
let settingsStore: typeof import('../settingsStore.js');

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'settings-store-test-'));
  process.env.PAPERS_ROOT = tempDir;
  settingsStore = await import('../settingsStore.js');
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('settingsStore sources', () => {
  it('returns defaults for all known sources when no settings file exists', () => {
    const s = settingsStore.readSettings();
    expect(s.sources.arxiv.enabled).toBe(true);
    expect(s.sources.openalex.enabled).toBe(true);
    expect(s.sources.iacr.enabled).toBe(true);
    expect(s.sources.semantic.enabled).toBe(false);
    expect(s.sources.zenodo.enabled).toBe(false);
  });

  it('merges persisted source settings over defaults', () => {
    settingsStore.writeSettings({
      model: 'v4-flash',
      sources: [{ source: 'semantic', enabled: true, key: 's2-key' }],
    });
    const s = settingsStore.readSettings();
    expect(s.sources.semantic.enabled).toBe(true);
    expect(s.sources.semantic.key).toBe('s2-key');
    expect(s.sources.arxiv.enabled).toBe(true);
  });

  it('keeps the existing key when an empty key is submitted', () => {
    settingsStore.writeSettings({
      sources: [{ source: 'semantic', enabled: false }],
    });
    const s = settingsStore.readSettings();
    expect(s.sources.semantic.enabled).toBe(false);
    expect(s.sources.semantic.key).toBe('s2-key');
  });

  it('persists settings file without unknown source keys', () => {
    settingsStore.writeSettings({
      sources: [{ source: 'unknown-source', enabled: true, key: 'x' }],
    });
    const s = settingsStore.readSettings();
    expect(s.sources['unknown-source']).toBeUndefined();
    const raw = JSON.parse(readFileSync(join(tempDir, 'settings.json'), 'utf-8'));
    expect(raw.sources['unknown-source']).toBeUndefined();
  });

  it('exposes source views without key plaintext', () => {
    const s = settingsStore.readSettings();
    const views = settingsStore.sourceViews(s);
    const semantic = views.find((v) => v.source === 'semantic');
    expect(semantic).toMatchObject({
      label: 'Semantic Scholar',
      download: true,
      keyEnv: 'PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY',
      enabled: false,
      hasKey: true,
    });
    expect(semantic).not.toHaveProperty('key');
    expect(Object.keys(semantic as unknown as Record<string, unknown>)).not.toContain('key');
  });

  it('persists and reads mineruToken', () => {
    settingsStore.writeSettings({ mineruToken: 'mt-abc' });
    expect(settingsStore.readSettings().mineruToken).toBe('mt-abc');
    const raw = JSON.parse(readFileSync(join(tempDir, 'settings.json'), 'utf-8'));
    expect(raw.mineruToken).toBe('mt-abc');
  });

  it('defaults mineruToken to empty string', () => {
    settingsStore.writeSettings({ mineruToken: '' });
    expect(settingsStore.readSettings().mineruToken).toBe('');
  });
});

describe('settingsStore providers', () => {
  it('defaults to a DeepSeek provider when no settings file exists', () => {
    const s = settingsStore.readSettings();
    expect(s.providers).toHaveLength(1);
    expect(s.providers[0]).toMatchObject({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    expect(s.activeProviderId).toBe('deepseek');
    expect(settingsStore.getActiveProvider(s).id).toBe('deepseek');
  });

  it('migrates legacy apiKey/baseUrl into a DeepSeek provider', () => {
    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ apiKey: 'sk-legacy', baseUrl: 'https://relay.example.com/v1' }),
    );
    const s = settingsStore.readSettings();
    expect(s.providers).toHaveLength(1);
    expect(s.providers[0]).toMatchObject({
      id: 'deepseek',
      apiKey: 'sk-legacy',
      baseUrl: 'https://relay.example.com/v1',
    });
    expect(settingsStore.getActiveProvider(s).apiKey).toBe('sk-legacy');
  });

  it('persists multiple providers and activeProviderId', () => {
    settingsStore.writeSettings({
      providers: [
        { id: 'deepseek', name: 'DeepSeek', apiKey: 'sk-ds', baseUrl: 'https://a/v1' },
        { id: 'my-relay', name: 'MyRelay', apiKey: 'sk-relay', baseUrl: 'https://b/v1' },
      ],
      activeProviderId: 'my-relay',
    });
    const s = settingsStore.readSettings();
    expect(s.providers).toHaveLength(2);
    expect(s.activeProviderId).toBe('my-relay');
    expect(settingsStore.getActiveProvider(s).baseUrl).toBe('https://b/v1');
    const raw = JSON.parse(readFileSync(join(tempDir, 'settings.json'), 'utf-8'));
    expect(raw.providers).toHaveLength(2);
    expect(raw.activeProviderId).toBe('my-relay');
  });

  it('sanitizes provider ids and dedupes', () => {
    settingsStore.writeSettings({
      providers: [
        { id: 'OpenAI/Labs', name: 'X', apiKey: 'k1', baseUrl: 'https://a/v1' },
        { id: 'OpenAI-Labs', name: 'Y', apiKey: 'k2', baseUrl: 'https://b/v1' },
        { id: 'deepseek', name: 'DS', apiKey: 'k3', baseUrl: 'https://c/v1' },
      ],
    });
    const s = settingsStore.readSettings();
    const ids = s.providers.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['openai-labs', 'openai-labs-2', 'deepseek']));
  });

  it('keeps active provider when updating an unrelated provider list', () => {
    settingsStore.writeSettings({
      providers: [
        { id: 'deepseek', name: 'DeepSeek', apiKey: 'k1', baseUrl: 'https://a/v1' },
      ],
      activeProviderId: 'deepseek',
    });
    settingsStore.writeSettings({
      providers: [
        { id: 'deepseek', name: 'DeepSeek', apiKey: 'k1-new', baseUrl: 'https://a/v1' },
      ],
    });
    const s = settingsStore.readSettings();
    expect(s.activeProviderId).toBe('deepseek');
    expect(s.providers[0].apiKey).toBe('k1-new');
  });
});
