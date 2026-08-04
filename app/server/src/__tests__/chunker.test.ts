import { describe, it, expect } from 'vitest';
import { parseMd } from '../chunker.js';

describe('parseMd', () => {
  it('extracts title from # heading', () => {
    const result = parseMd('# My Paper Title\n\n## Abstract\n\nSome content here.');
    expect(result.title).toBe('My Paper Title');
  });

  it('detects and extracts Abstract section', () => {
    const result = parseMd(
      '# Test Paper\n\n**Abstract**\n\nThis paper explores new methods.\n\n## Introduction\n\nBody text.',
    );
    expect(result.chunks[0].heading).toBe('Abstract');
    expect(result.chunks[0].content).toBe('This paper explores new methods.');
  });

  it('detects Abstract in bold-with-colon format', () => {
    const result = parseMd(
      '# Test Paper\n\n**Abstract:** This paper explores new methods.\n\n## Introduction\n\nBody text.',
    );
    expect(result.chunks[0].heading).toBe('Abstract');
    expect(result.chunks[0].content).toBe('This paper explores new methods.');
  });

  it('splits sections by ## headings', () => {
    const result = parseMd(
      '# Title\n\n**Abstract**\n\nAbstract text.\n\n## Introduction\n\nIntro body.\n\n## Methods\n\nMethods body.',
    );
    const headings = result.chunks.map((c) => c.heading);
    expect(headings).toContain('Abstract');
    expect(headings).toContain('Introduction');
    expect(headings).toContain('Methods');
  });

  it('handles multi-level headings (###, ####) embedded in parent', () => {
    const result = parseMd(
      '# Title\n\n**Abstract**\n\nAbs.\n\n## Methods\n\nBody.\n\n### Sub section\n\nSub body.\n\n#### Deep\n\nDeep body.',
    );
    const methods = result.chunks.find((c) => c.heading === 'Methods');
    expect(methods).toBeDefined();
    expect(methods!.content).toContain('### Sub section');
    expect(methods!.content).toContain('#### Deep');
  });

  it('handles markdown without Abstract', () => {
    const result = parseMd('# Title\n\n## Introduction\n\nIntro text.');
    expect(result.chunks[0].heading).toBe('Introduction');
  });

  it('defaults title to Untitled if no # heading', () => {
    const result = parseMd('## Section\n\nSome content.');
    expect(result.title).toBe('Untitled');
  });

  it('tracks char_count per chunk', () => {
    const result = parseMd('# T\n\n**Abstract**\n\nHello.\n\n## Methods\n\nSome text here.');
    const abstract = result.chunks.find((c) => c.heading === 'Abstract');
    expect(abstract?.char_count).toBe(6);
  });
});
