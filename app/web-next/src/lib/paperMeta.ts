/** 论文元数据的展示辅助函数（PaperList 与 PaperPreviewDrawer 共用）。 */

export const SOURCE_LABELS: Record<string, string> = {
  manual: '手动',
  arxiv: 'arXiv',
  semantic: 'Semantic Scholar',
  openalex: 'OpenAlex',
  iacr: 'IACR',
  zenodo: 'Zenodo',
};

export function parseSource(source?: string): string {
  if (!source) return 'manual';
  return source.endsWith('-auto') ? source.slice(0, -'-auto'.length) : source;
}

export function sourceLabel(source?: string): string {
  return SOURCE_LABELS[parseSource(source)] ?? parseSource(source);
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}
