import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeTitle,
  titleSimilarity,
  isArxivId,
  needsEnrich,
  mergeChanges,
  restoreAbstract,
  _private,
} from '../metaEnrich.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeTitle / titleSimilarity', () => {
  it('normalizes case, punctuation and whitespace', () => {
    expect(normalizeTitle('  Diffusion-Based  Attacks, (v2)  ')).toBe('diffusion based attacks v2');
  });

  it('scores exact match 1, substantial containment 0.95', () => {
    expect(titleSimilarity('Diffusion Attacks', 'diffusion attacks')).toBe(1);
    // 短标题占长标题 ≥60% 的包含才算
    expect(
      titleSimilarity(
        'AEGIS: A Mechanism-Guided Defense against Visual Synonym Jailbreaks in Text-to-Image Models',
        'AEGIS: A Mechanism-Guided Defense against Visual Synonym Jailbreaks',
      ),
    ).toBe(0.95);
  });

  it('rejects short titles merely contained in a longer query (误配防护)', () => {
    // 3 词标题被 14 词查询整句包含 → 拒绝（词数 <4）
    expect(
      titleSimilarity(
        'Watch Your Step: Information Injection in Diffusion Models via Shadow Timestep Embedding',
        'Watch Your Step',
      ),
    ).toBe(0);
    // 4 词通用短语标题，占比 4/12=0.33 < 0.5 → 拒绝
    expect(
      titleSimilarity(
        'Hidden in Plain Sight: Diffusion-Based Unrestricted Robotic Attacks on Vision-Language-Action Models',
        'Hidden in Plain Sight',
      ),
    ).toBe(0);
    // 短标题占比不足但重合率高的歧义匹配（如 IJSREM 的 Stable Diffusion 短标题）→ 拒绝
    expect(
      titleSimilarity(
        'Disciplined Diffusion: Text-to-Image Diffusion Model against NSFW Generation',
        'Stable Diffusion Text-Image Generation',
      ),
    ).toBe(0);
  });

  it('tolerates single-token typos via overlap', () => {
    // "Difusion" vs "Diffusion" — 1 typo, overlap 6/7=0.857 ≥ 0.85
    expect(titleSimilarity('Bypassing Copyright Protection in Difusion-based Customization',
      'Bypassing Copyright Protection in Diffusion-based Customization')).toBeGreaterThan(0.75);
  });

  it('rejects unrelated titles', () => {
    expect(titleSimilarity('Attention Is All You Need', 'ResNet Image Classification')).toBeLessThan(0.75);
  });
});

describe('isArxivId', () => {
  it('matches arxiv ids with/without version', () => {
    expect(isArxivId('2607.28936')).toBe(true);
    expect(isArxivId('2607.28936v1')).toBe(true);
    expect(isArxivId('2312.11285')).toBe(true);
  });
  it('rejects non-arxiv ids', () => {
    expect(isArxivId('test-paper')).toBe(false);
    expect(isArxivId('sciverse-abc')).toBe(false);
    expect(isArxivId('Diff-NAT_AAAI2026')).toBe(false);
  });
});

describe('restoreAbstract', () => {
  it('reconstructs text from inverted index', () => {
    const inverted = { 'hello': [0], 'world': [2], 'diffusion': [1] };
    expect(restoreAbstract(inverted)).toBe('hello diffusion world');
  });
  it('returns undefined for empty input', () => {
    expect(restoreAbstract(undefined)).toBeUndefined();
    expect(restoreAbstract({})).toBeUndefined();
  });
});

describe('needsEnrich', () => {
  it('true when any key field is missing', () => {
    expect(needsEnrich({ doi: '10.1000/x', venue: 'CVPR', year: '2025', authors: ['A'], abstract: 'a' })).toBe(false);
    expect(needsEnrich({ doi: '10.1000/x', venue: 'CVPR', year: '2025' })).toBe(true);
    expect(needsEnrich({ doi: '10.48550/arXiv.2607.28936', venue: 'CVPR', year: '2025', authors: ['A'], abstract: 'a' })).toBe(true);
    expect(needsEnrich({ doi: '10.1000/x', venue: '未收录', year: '2025', authors: ['A'], abstract: 'a' })).toBe(true);
  });
});

describe('mergeChanges (刷新规则)', () => {
  it('fills missing fields', () => {
    const { changes, source } = mergeChanges(
      { doi: undefined, venue: undefined, year: undefined, authors: [], abstract: undefined },
      { doi: '10.1000/a', venue: 'ICLR', year: '2026', authors: ['A'], abstract: 'abs' },
      'openalex',
    );
    expect(changes).toEqual({ doi: '10.1000/a', venue: 'ICLR', year: '2026', authors: ['A'], abstract: 'abs' });
    expect(source).toBe('openalex');
  });

  it('never overwrites a valid existing doi', () => {
    const { changes } = mergeChanges(
      { doi: '10.1000/valid', venue: undefined, year: undefined },
      { doi: '10.9999/other', venue: 'CVPR', year: '2026' },
      'crossref',
    );
    expect(changes.doi).toBeUndefined();
    expect(changes.venue).toBe('CVPR');
  });

  it('replaces invalid (non-standard) doi like arXiv:xxxx', () => {
    const { changes } = mergeChanges(
      { doi: 'arXiv:2412.15341', venue: undefined, year: undefined },
      { doi: '10.1000/real', venue: 'CVPR', year: '2026' },
      'crossref',
    );
    expect(changes.doi).toBe('10.1000/real');
  });

  it('never overwrites a real venue but replaces 未收录', () => {
    const keep = mergeChanges({ doi: undefined, venue: 'ECCV', year: undefined }, { venue: 'ICCV' }, 'openalex');
    expect(keep.changes.venue).toBeUndefined();
    const fill = mergeChanges({ doi: undefined, venue: '未收录', year: undefined }, { venue: 'ICCV' }, 'openalex');
    expect(fill.changes.venue).toBe('ICCV');
  });

  it('refreshes year when a different authoritative year is found', () => {
    const { changes } = mergeChanges(
      { doi: undefined, venue: undefined, year: '2026' },
      { year: '2027', venue: 'NeurIPS' },
      'openalex',
    );
    expect(changes.year).toBe('2027');
  });

  it('keeps existing authors and abstract', () => {
    const { changes } = mergeChanges(
      { doi: undefined, venue: undefined, year: undefined, authors: ['A'], abstract: 'old' },
      { authors: ['B'], abstract: 'new' },
      'openalex',
    );
    expect(changes.authors).toBeUndefined();
    expect(changes.abstract).toBeUndefined();
  });
});

describe('数据源解析', () => {
  it('parses arXiv Atom entry (journal_ref + doi + authors + abstract)', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2607.28936v1</id>
    <title>Diffusion Attacks on Neural Networks</title>
    <summary>We study adversarial attacks with diffusion models.</summary>
    <author><name>Alice Chen</name></author>
    <author><name>Bob Li</name></author>
    <arxiv:journal_ref>Proc. CVPR 2026</arxiv:journal_ref>
    <arxiv:doi>10.1109/CVPR.2026.12345</arxiv:doi>
  </entry>
</feed>`;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => xml });
    vi.stubGlobal('fetch', fetchMock);
    const result = await _private.queryArxivApi('2607.28936v1');
    expect(result).toEqual({
      doi: '10.1109/CVPR.2026.12345',
      venue: 'Proc. CVPR 2026',
      authors: ['Alice Chen', 'Bob Li'],
      abstract: 'We study adversarial attacks with diffusion models.',
    });
  });

  it('filters arXiv-only DOI (10.48550) from OpenAlex results and restores abstract', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{
          title: 'Diffusion Attacks on Neural Networks',
          doi: 'https://doi.org/10.48550/arXiv.2607.28936',
          publication_year: 2026,
          primary_location: { source: { display_name: 'arXiv' } },
          authorships: [{ author: { display_name: 'Alice Chen' } }],
          abstract_inverted_index: { 'attacks': [0], 'study': [1], 'we': [2] },
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await _private.queryOpenAlex('Diffusion Attacks', '2607.28936');
    expect(result).toEqual({
      doi: undefined, // 10.48550 被过滤
      venue: undefined, // arXiv 被过滤
      year: '2026',
      authors: ['Alice Chen'],
      abstract: 'attacks study we',
    });
  });

  it('returns null when Crossref has no matching title', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { items: [{ title: ['Totally Different Paper'], DOI: '10.1000/x' }] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await _private.queryCrossref('Diffusion Attacks on Neural Networks');
    expect(result).toBeNull();
  });
});
