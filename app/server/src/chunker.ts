const HEADING_RE = /^(#{1,6})\s+(.+)$/;
// 同时匹配英文 Abstract 与中文 摘要（MD 翻译版），保证中英文分块索引对齐
const ABSTRACT_RE = /^(#{1,4}\s+)?(\*\*)?(Abstract|摘要)(\*\*)?[.\-\—:]*(\*\*)?\s*/im;

export interface Chunk {
  heading: string;
  heading_level: number;
  content: string;
  char_count: number;
}

export interface ParseResult {
  title: string;
  chunks: Chunk[];
}

function extractTitle(lines: string[]): { title: string; startIdx: number } {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+)/);
    if (m) return { title: m[1].trim(), startIdx: i };
  }
  return { title: 'Untitled', startIdx: 0 };
}

function findFirstHeadingLine(lines: string[], fromIdx: number): number {
  for (let i = fromIdx; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) return i;
  }
  return lines.length;
}

function detectAbstract(preText: string): { content: string } | null {
  const m = preText.match(ABSTRACT_RE);
  if (!m) return null;
  const content = preText.slice(m.index! + m[0].length).trim().replace(/\n{3,}/g, '\n\n');
  if (!content) return null;
  return { content };
}

function splitByHeadings(lines: string[], startIdx: number): Chunk[] {
  const chunks: Chunk[] = [];

  let i = startIdx;
  while (i < lines.length) {
    const m = lines[i].match(HEADING_RE);
    if (!m) {
      i++;
      continue;
    }
    const level = m[1].length;
    const heading = m[2].trim();
    i++;

    const contentLines: string[] = [];
    while (i < lines.length && !/^##\s/.test(lines[i])) {
      contentLines.push(lines[i]);
      i++;
    }

    const content = contentLines.join('\n').trim();
    chunks.push({
      heading,
      heading_level: level,
      content,
      char_count: content.length,
    });
  }

  return chunks;
}

export function parseMd(markdown: string): ParseResult {
  const lines = markdown.split('\n');
  const { title, startIdx } = extractTitle(lines);

  const firstH2 = findFirstHeadingLine(lines, startIdx + 1);
  const preLines = lines.slice(startIdx + 1, firstH2);
  const preText = preLines.join('\n');

  const chunks: Chunk[] = [];

  const abstract = detectAbstract(preText);
  if (abstract) {
    chunks.push({
      heading: 'Abstract',
      heading_level: 2,
      content: abstract.content,
      char_count: abstract.content.length,
    });
  }

  const headingChunks = splitByHeadings(lines, firstH2);
  chunks.push(...headingChunks);

  return { title, chunks };
}
