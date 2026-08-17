/**
 * 用 MinerU OCR 模式重新解析 PDF，修复文字层缺字 / 误标 <sub><sup> 的问题。
 *
 * 用法：
 *   tsx scripts/reparse-ocr.ts                       # 处理默认 5 篇已知问题论文
 *   tsx scripts/reparse-ocr.ts <id> [<id> ...]       # 处理指定论文
 *   tsx scripts/reparse-ocr.ts --all                 # 处理全部有 PDF 的论文
 *
 * 流程（每篇）：备份旧 MD → MinerU OCR 提取（vlm+ocr，若仍噪音则 v2.1+ocr 重试，
 * 取噪音最少的结果）→ 重分块 + 更新标题 → 重向量化（尽力而为）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { RAW_PDF_DIR, MD_DIR } from '../src/paths.js';
import { extractPdfToMd } from '../src/mineru.js';
import { parseMd } from '../src/chunker.js';
import { saveChunks, insertPaper } from '../src/db.js';
import { embedPaper, vectorEnabled } from '../src/vectorStore.js';

const DEFAULT_IDS = [
  '2608.10393v1', // Hidden in Plain Sight: Diffusion-Based ...
  '2608.10985v1',
  '2606.09909v1',
  '2605.14396v1',
  'ResolutionAttack_ICLR2025',
];

/** 统计 <sub>/<sup> 噪音数量（近似，按出现次数） */
function countNoise(md: string): number {
  return (md.match(/<\/?(?:sub|sup)>/gi) ?? []).length;
}

/** 读取 MD 第一行标题（# 标题） */
function mdTitle(md: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : 'Untitled';
}

function backupOldMd(id: string): boolean {
  const mdPath = path.join(MD_DIR, `${id}.md`);
  if (!fs.existsSync(mdPath)) return false;
  const backupDir = path.join(process.cwd(), '..', '..', 'tmp', 'reparse-backup');
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(mdPath, path.join(backupDir, `${id}.md.bak`));
  return true;
}

async function extractBest(pdfPath: string, id: string): Promise<{ md: string; noise: number; attempts: string[] }> {
  const attempts: string[] = [];
  const candidates: { md: string; noise: number; label: string }[] = [];

  // MinerU 按文件字节哈希缓存结果（v2.x 模型已下线，只能用 vlm + parse_mode=ocr）。
  // 注入 PDF 注释改字节 + 唯一 data_id 双重绕缓存；两次尝试兜底。
  const combos: { label: string; opts: Parameters<typeof extractPdfToMd>[2] }[] = [1, 2].map((n) => ({
    label: `vlm+ocr#${n}`,
    opts: {
      parseMode: 'ocr' as const,
      modelVersion: 'vlm',
      dataId: `${id}-reparse-${Date.now()}-${n}`,
      bustCache: true,
    },
  }));

  for (const combo of combos) {
    const started = Date.now();
    await extractPdfToMd(pdfPath, id, combo.opts);
    const md = fs.readFileSync(path.join(MD_DIR, `${id}.md`), 'utf-8');
    const noise = countNoise(md);
    const secs = Math.round((Date.now() - started) / 1000);
    attempts.push(`${combo.label} (${secs}s, noise=${noise})`);
    candidates.push({ md, noise, label: combo.label });
    console.log(`  [${id}] ${combo.label} done in ${secs}s, sub/sup noise=${noise}`);
    if (noise < 20) break; // 足够干净，无需再试
  }

  candidates.sort((a, b) => a.noise - b.noise);
  const best = candidates[0];
  // 确保磁盘上是噪音最少的那份
  if (best) fs.writeFileSync(path.join(MD_DIR, `${id}.md`), best.md, 'utf-8');
  return { md: best?.md ?? '', noise: best?.noise ?? Number.MAX_SAFE_INTEGER, attempts };
}

async function refreshDb(id: string, md: string): Promise<void> {
  const { title, chunks } = parseMd(md);
  saveChunks(id, chunks);
  insertPaper(id, title, md.length);
  console.log(`  [${id}] re-chunked: ${chunks.length} chunks, title="${title}"`);

  if (vectorEnabled()) {
    try {
      const n = await embedPaper(id);
      console.log(`  [${id}] re-embedded: ${n} chunks`);
    } catch (e) {
      console.warn(`  [${id}] re-embed failed (skip): ${e instanceof Error ? e.message : e}`);
    }
  } else {
    console.log(`  [${id}] vector service disabled, skip embedding`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let ids: string[];
  if (args.includes('--all')) {
    ids = fs
      .readdirSync(MD_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .filter((id) => fs.existsSync(path.join(RAW_PDF_DIR, `${id}.pdf`)));
  } else if (args.length > 0) {
    ids = args;
  } else {
    ids = DEFAULT_IDS;
  }

  console.log(`== reparse-ocr: ${ids.length} papers ==`);
  for (const id of ids) {
    const pdfPath = path.join(RAW_PDF_DIR, `${id}.pdf`);
    if (!fs.existsSync(pdfPath)) {
      console.warn(`  [${id}] rawPDF missing, skip`);
      continue;
    }
    const oldMdPath = path.join(MD_DIR, `${id}.md`);
    const oldMd = fs.existsSync(oldMdPath) ? fs.readFileSync(oldMdPath, 'utf-8') : '';
    const oldNoise = countNoise(oldMd);
    const oldTitle = oldMd ? mdTitle(oldMd) : '(no md)';
    console.log(`\n[${id}] BEFORE: noise=${oldNoise}, title="${oldTitle}"`);

    try {
      backupOldMd(id);
      const { md, noise, attempts } = await extractBest(pdfPath, id);
      if (!md) throw new Error('extraction returned empty md');
      const newTitle = mdTitle(md);
      console.log(`  [${id}] AFTER:  noise=${noise}, title="${newTitle}" (attempts: ${attempts.join(' | ')})`);
      await refreshDb(id, md);
      console.log(`  [${id}] OK (noise ${oldNoise} -> ${noise})`);
    } catch (e) {
      console.error(`  [${id}] FAILED: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log('\n== reparse-ocr finished ==');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
