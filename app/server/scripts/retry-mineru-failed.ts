/**
 * 补跑 mineru-failed/ 里解析失败的论文（一次性维护脚本）。
 *
 * 对每份失败 PDF：
 *   1. 用 papers.json 已有元数据（无则从 arXiv id 推导 year/source/sourceId）调 createPaper 重新入库
 *   2. 成功 → 删除 mineru-failed 里的 PDF（rawPDF/MD/SQLite 由 createPaper 落盘）
 *   3. 后台向量化（bge-m3）+ AI 分类（新增论文无 directions 时）
 *
 * 用法：pnpm tsx scripts/retry-mineru-failed.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { MINERU_FAILED_DIR } from '../src/paths.js';
import { createPaper } from '../src/store.js';
import { readMeta, writeMeta } from '../src/meta.js';
import { readResearchConfig } from '../src/researchConfig.js';
import { readSettings, getActiveProvider } from '../src/settingsStore.js';
import { classifyTitleAbstract, extractTitleAndAbstract } from '../src/classify.js';
import * as vectorStore from '../src/vectorStore.js';

async function main(): Promise<void> {
  const files = fs
    .readdirSync(MINERU_FAILED_DIR)
    .filter((f) => f.endsWith('.pdf'))
    .sort();
  if (files.length === 0) {
    console.log('mineru-failed 为空，无需补跑');
    return;
  }
  console.log(`待补跑 ${files.length} 份：${files.join(', ')}`);

  const meta = readMeta();
  const cfg = readResearchConfig();
  const dirNames = cfg.directions.map((d) => d.name);
  const active = getActiveProvider(readSettings());
  const ok: string[] = [];
  const fail: string[] = [];

  for (const f of files) {
    const id = f.replace(/\.pdf$/, '');
    const pdfPath = path.join(MINERU_FAILED_DIR, f);
    const prev = meta[id] ?? {};
    const year =
      prev.year ??
      (id.match(/^(\d{2})\d{2}\./)?.[1] ? `20${id.slice(0, 2)}` : undefined);
    const source = prev.source ?? 'arxiv-auto';
    const sourceId = prev.sourceId ?? id.replace(/v\d+$/, '');

    console.log(`\n>>> 解析 ${id}（${pdfPath}）...`);
    try {
      const paper = await createPaper({
        pdfPath,
        id,
        tags: prev.tags ?? [],
        venue: prev.venue,
        year,
        area: prev.area ?? dirNames[0],
        source,
        sourceId,
        directions: prev.directions ?? [],
      });

      // finishPaper 会把 addedAt 刷新为 now，这里恢复原值（若存在）
      if (prev.addedAt) {
        const m = readMeta();
        if (m[id]) {
          m[id].addedAt = prev.addedAt;
          writeMeta(m);
        }
      }

      fs.rmSync(pdfPath, { force: true });
      console.log(`  ✅ 入库成功: ${paper.title}`);
      ok.push(id);

      if (vectorStore.vectorEnabled()) {
        try {
          const n = await vectorStore.embedPaper(id);
          console.log(`  ✅ 向量化完成: ${n} chunks`);
        } catch (e) {
          console.warn(`  ⚠️ 向量化失败（不影响入库）: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if ((prev.directions?.length ?? 0) === 0 && active.apiKey && dirNames.length > 0) {
        try {
          const { title, abstract } = extractTitleAndAbstract(paper.markdown);
          const matched = await classifyTitleAbstract(title || paper.title, abstract, dirNames, active.apiKey, active.baseUrl);
          if (matched.length > 0) {
            const m = readMeta();
            if (m[id]) {
              m[id].directions = matched;
              writeMeta(m);
            }
            console.log(`  ✅ AI 分类: ${matched.join(', ')}`);
          }
        } catch (e) {
          console.warn(`  ⚠️ AI 分类失败（保持默认方向）: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      console.error(`  ❌ ${id} 补跑失败: ${e instanceof Error ? e.message : String(e)}`);
      fail.push(id);
    }
  }

  console.log(`\n==== 补跑结果: 成功 ${ok.length} / 失败 ${fail.length} ====`);
  if (ok.length) console.log('成功:', ok.join(', '));
  if (fail.length) console.log('失败:', fail.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
