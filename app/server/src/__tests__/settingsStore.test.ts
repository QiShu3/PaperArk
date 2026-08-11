import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
      apiKey: 'k',
      model: 'v4-flash',
      baseUrl: 'https://x/v1',
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
});
