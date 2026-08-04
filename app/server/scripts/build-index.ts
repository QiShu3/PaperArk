import fs from 'node:fs';
import path from 'node:path';
import { MD_DIR } from '../src/paths.js';
import { clearPaper, insertPaper, insertChunk, getStats } from '../src/db.js';
import { parseMd } from '../src/chunker.js';
import db from '../src/db.js';

function extractSectionNum(heading: string): string {
  const m = heading.match(/^(\S+)/);
  if (!m) return heading;
  let num = m[1];
  if (num.endsWith('.') && num.length > 1) {
    num = num.slice(0, -1);
  }
  return num;
}

function resolveParent(
  sectionNum: string,
  sectionMap: Map<string, number>
): number | null {
  let prefix = sectionNum;
  while (true) {
    const dot = prefix.lastIndexOf('.');
    if (dot === -1) return null;
    prefix = prefix.slice(0, dot);
    const parentId = sectionMap.get(prefix);
    if (parentId !== undefined) return parentId;
  }
}

function indexPaper(id: string, mdContent: string): number {
  const { title, chunks } = parseMd(mdContent);
  const totalChars = chunks.reduce((sum, c) => sum + c.char_count, 0);

  clearPaper(id);
  insertPaper(id, title, totalChars);

  const sectionMap = new Map<string, number>();
  let chunkCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]!;
    const sectionNum = extractSectionNum(c.heading);
    const parentId = resolveParent(sectionNum, sectionMap);

    const rowId = insertChunk(
      id,
      i,
      parentId,
      c.heading,
      c.heading_level,
      c.content,
      c.char_count
    );

    sectionMap.set(sectionNum, rowId);
    chunkCount++;
  }

  return chunkCount;
}

function main() {
  const mdFiles = fs
    .readdirSync(MD_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .sort();

  let totalChunks = 0;
  const results: Array<{ id: string; title: string; chunks: number }> = [];

  for (const filename of mdFiles) {
    const id = path.basename(filename, '.md');
    const mdPath = path.join(MD_DIR, filename);
    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    const chunkCount = indexPaper(id, mdContent);
    totalChunks += chunkCount;

    const { title } = parseMd(mdContent);
    results.push({ id, title, chunks: chunkCount });
  }

  const stats = getStats();
  console.log(`\nPapers indexed: ${stats.papers}`);
  console.log(`Total chunks:  ${stats.chunks}`);
  console.log(`DB path:       ${mdFiles.length > 0 ? 'papers.db' : 'N/A'}`);
  console.log('');

  for (const r of results) {
    console.log(`  ${r.id}  |  ${r.chunks} chunks  |  ${r.title.slice(0, 60)}`);
  }

  const meta = db.prepare('SELECT COUNT(*) AS cnt FROM chunks_fts').get() as { cnt: number };
  console.log(`\nFTS entries:   ${meta.cnt}`);
}

main();
