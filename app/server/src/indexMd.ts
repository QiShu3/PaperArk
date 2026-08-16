import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { MD_DIR, INDEX_MD } from './paths.js';

export function extractTitle(mdPath: string): string {
  try {
    const content = fs.readFileSync(mdPath, 'utf-8');
    const lines = content.split('\n');
    // 优先取第一个一级标题（与 chunker.extractTitle 保持一致），
    // 避免 MinerU 输出头部有期刊页眉等非标题文本时把页眉当标题。
    for (const line of lines) {
      const m = line.match(/^#\s+(.+)/);
      if (m) return m[1].trim();
    }
    const firstLine = lines.find((l) => l.trim().length > 0) ?? '';
    return firstLine.replace(/^#+\s+/, '').trim() || path.basename(mdPath, '.md');
  } catch {
    return path.basename(mdPath, '.md');
  }
}

export function listMdIds(): string[] {
  return fg
    .sync('*.md', { cwd: MD_DIR })
    .filter((f) => f !== 'index.md')
    .map((f) => path.basename(f, '.md'))
    .sort();
}

export function rebuildIndex(): void {
  const ids = listMdIds();
  const rows = ids.map((id, i) => {
    const title = extractTitle(path.join(MD_DIR, `${id}.md`));
    return `| ${i + 1} | ${title} | ${id} | [PDF](../rawPDF/${id}.pdf) · [arXiv](https://arxiv.org/abs/${id}) |`;
  });
  const content = `# Papers Index\n\n| # | 标题 | arXiv ID | 链接 |\n|---|------|----------|------|\n${rows.join('\n')}\n`;
  fs.writeFileSync(INDEX_MD, content, 'utf-8');
}
