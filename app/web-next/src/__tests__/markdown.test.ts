import { describe, it, expect } from 'vitest';
import { resolveImage } from '../lib/markdown';

describe('resolveImage', () => {
  it('rewrites sciverse dt= references to the resource proxy', () => {
    expect(resolveImage('dt=xxx/p_yyy/f3.png')).toBe(
      '/api/sciverse/resource?file_name=dt%3Dxxx%2Fp_yyy%2Ff3.png',
    );
  });

  it('keeps http/https and absolute paths untouched', () => {
    expect(resolveImage('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(resolveImage('/MD/images/a.png')).toBe('/MD/images/a.png');
    expect(resolveImage('data:image/png;base64,xxx')).toBe('data:image/png;base64,xxx');
  });

  it('keeps existing local image handling', () => {
    expect(resolveImage('images/foo.png')).toBe('/MD/images/foo.png');
    expect(resolveImage('./images/bar.png')).toBe('/MD/images/bar.png');
  });
});
