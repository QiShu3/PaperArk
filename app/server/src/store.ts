import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { RAW_PDF_DIR, MD_DIR, IMAGES_DIR } from './paths.js';
import { readMeta, writeMeta } from './meta.js';
import { extractTitle, listMdIds, rebuildIndex } from './indexMd.js';
import { extractPdfToMd } from './mineru.js';
import { parseMd } from './chunker.js';
import { saveChunks } from './db.js';

export interface Paper {
  id: string;
  title: string;
  tags: string[];
  notes?: string;
  addedAt?: string;
  venue?: string;
  year?: string;
  area?: string;
  source?: string;
  hasMd: boolean;
  hasPdf: boolean;
}

export type PaperDetail = Paper & { markdown: string };
export type SearchResult = Paper & { snippet: string };

function listIds(): string[] {
  const mdIds = listMdIds();
  const pdfIds = fg
    .sync('*.pdf', { cwd: RAW_PDF_DIR })
    .map((f) => path.basename(f, '.pdf'));
  return Array.from(new Set([...mdIds, ...pdfIds])).sort();
}

function referencedImages(): Set<string> {
  const set = new Set<string>();
  const re = /images\/([^\s)"']+)/g;
  for (const id of listMdIds()) {
    const content = fs.readFileSync(path.join(MD_DIR, `${id}.md`), 'utf-8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) set.add(m[1]);
  }
  return set;
}

export function listPapers(): Paper[] {
  const meta = readMeta();
  return listIds().map((id) => {
    const mdPath = path.join(MD_DIR, `${id}.md`);
    const hasMd = fs.existsSync(mdPath);
    const m = meta[id];
    return {
      id,
      title: hasMd ? extractTitle(mdPath) : id,
      tags: m?.tags ?? [],
      notes: m?.notes,
      addedAt: m?.addedAt,
      venue: m?.venue,
      year: m?.year,
      area: m?.area,
      source: m?.source,
      hasMd,
      hasPdf: fs.existsSync(path.join(RAW_PDF_DIR, `${id}.pdf`)),
    };
  });
}

export function getPaper(id: string): PaperDetail | null {
  const paper = listPapers().find((p) => p.id === id);
  if (!paper) return null;
  const markdown = getRawMarkdown(id);
  return { ...paper, markdown };
}

export function getRawMarkdown(id: string): string {
  const mdPath = path.join(MD_DIR, `${id}.md`);
  return fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : '';
}

export function listTags(): { tag: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const p of listPapers()) {
    for (const t of p.tags) counts[t] = (counts[t] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function search(q: string): SearchResult[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const results: SearchResult[] = [];
  for (const p of listPapers()) {
    const mdPath = path.join(MD_DIR, `${p.id}.md`);
    const content = p.hasMd ? fs.readFileSync(mdPath, 'utf-8') : '';
    const haystack = (p.title + '\n' + content).toLowerCase();
    if (!haystack.includes(query)) continue;
    const cidx = content.toLowerCase().indexOf(query);
    let snippet = '';
    if (cidx !== -1) {
      const start = Math.max(0, cidx - 60);
      snippet =
        (start > 0 ? '…' : '') +
        content.slice(start, cidx + query.length + 60).replace(/\s+/g, ' ').trim() +
        '…';
    }
    results.push({ ...p, snippet });
  }
  return results;
}

export interface UpdatePatch {
  markdown?: string;
  tags?: string[];
  notes?: string;
  venue?: string;
  year?: string;
  area?: string;
  source?: string;
}

export function updatePaper(id: string, patch: UpdatePatch): PaperDetail | null {
  const mdPath = path.join(MD_DIR, `${id}.md`);
  const exists = fs.existsSync(mdPath);
  if (!exists && patch.markdown === undefined) return null;

  if (patch.markdown !== undefined) {
    fs.writeFileSync(mdPath, patch.markdown, 'utf-8');
  }

  const meta = readMeta();
  const cur = meta[id] ?? { tags: [] };
  meta[id] = {
    tags: patch.tags ?? cur.tags ?? [],
    notes: patch.notes !== undefined ? patch.notes : cur.notes,
    addedAt: cur.addedAt ?? new Date().toISOString(),
    venue: patch.venue !== undefined ? patch.venue : cur.venue,
    year: patch.year !== undefined ? patch.year : cur.year,
    area: patch.area !== undefined ? patch.area : cur.area,
    source: patch.source !== undefined ? patch.source : cur.source,
  };
  writeMeta(meta);
  rebuildIndex();
  return getPaper(id);
}

export function deletePaper(id: string): void {
  fs.rmSync(path.join(RAW_PDF_DIR, `${id}.pdf`), { force: true });
  fs.rmSync(path.join(MD_DIR, `${id}.md`), { force: true });

  const meta = readMeta();
  delete meta[id];
  writeMeta(meta);

  if (fs.existsSync(IMAGES_DIR)) {
    const refs = referencedImages();
    for (const img of fg.sync('*', { cwd: IMAGES_DIR })) {
      if (!refs.has(img)) fs.rmSync(path.join(IMAGES_DIR, img), { force: true });
    }
  }

  rebuildIndex();
}

export interface CreateInput {
  pdfPath: string;
  id: string;
  tags: string[];
  venue?: string;
  year?: string;
  area?: string;
  source?: string;
}

export async function createPaper(input: CreateInput): Promise<PaperDetail> {
  const destPdf = path.join(RAW_PDF_DIR, `${input.id}.pdf`);
  fs.mkdirSync(RAW_PDF_DIR, { recursive: true });
  fs.mkdirSync(MD_DIR, { recursive: true });
  fs.copyFileSync(input.pdfPath, destPdf);

  await extractPdfToMd(destPdf, input.id);

  const mdPath = path.join(MD_DIR, `${input.id}.md`);
  const mdContent = fs.readFileSync(mdPath, 'utf-8');
  const { chunks } = parseMd(mdContent);
  saveChunks(input.id, chunks);

  const meta = readMeta();
  meta[input.id] = {
    tags: input.tags ?? [],
    addedAt: new Date().toISOString(),
    notes: meta[input.id]?.notes,
    venue: input.venue,
    year: input.year,
    area: input.area,
    source: input.source,
  };
  writeMeta(meta);
  rebuildIndex();

  const paper = getPaper(input.id);
  if (!paper) throw new Error('解析完成但未能读取生成的论文');
  return paper;
}
