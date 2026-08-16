/**
 * 跨论文分区聚合：为「快速浏览」页面提供每篇论文的
 * 摘要 / 引言 / 相关工作 / 方法 / 实验 / 结论 等分区的元数据。
 *
 * 数据来源：SQLite chunks 表（实时读取，不缓存——当前规模 1215 个 chunk
 * 全量扫描毫秒级，且天然无缓存失效问题）。
 */
import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';
import * as store from './store.js';
import { MD_TRANSLATION_DIR } from './paths.js';
import {
  classifyHeading,
  isSubsectionHeading,
  type SectionCategory,
} from './sections.js';

export interface SectionInfo {
  /** 代表性段（该分区第一个 chunk，通常即顶级章节本身） */
  chunkIndex: number;
  heading: string;
  charCount: number;
  images: string[];
  /** 该分区全部 chunk 索引（含编号子节，按正文顺序），用于浏览页拼接完整内容 */
  chunkIndexes: number[];
}

export interface OverviewEntry {
  paperId: string;
  title: string;
  year?: string;
  /** 是否存在 MD 中文翻译（md-translations/<id>.zh.md） */
  hasZh: boolean;
  sections: Partial<Record<SectionCategory, SectionInfo>>;
}

const IMAGE_RE = /!\[.*?\]\(([^)]+)\)/g;

function extractImages(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(IMAGE_RE)) {
    const src = m[1].trim();
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
}

function buildEntry(
  paper: { id: string; title: string; year?: string },
  chunks: { chunk_index: number; heading: string; content: string; char_count: number }[],
): OverviewEntry {
  const sections: Partial<Record<SectionCategory, SectionInfo>> = {};
  // 子节继承：记录论文中最近一个顶级分区
  let lastTop: SectionCategory | null = null;

  for (const c of chunks) {
    if (c.char_count <= 0 && !c.content) continue;

    let category: SectionCategory;
    if (isSubsectionHeading(c.heading)) {
      category = lastTop ?? classifyHeading(c.heading);
    } else {
      category = classifyHeading(c.heading);
      if (category !== 'other') lastTop = category;
    }
    if (category === 'other') continue;

    const cur = sections[category];
    if (!cur) {
      // 代表性段 = 该分区第一个 chunk（按正文顺序，通常即顶级分区本身）
      sections[category] = {
        chunkIndex: c.chunk_index,
        heading: c.heading,
        charCount: 0, // 下面统一累计，避免首块重复计数
        images: [],
        chunkIndexes: [],
      };
    }
    // 记录该分区全部 chunk（含子节），charCount 累计
    const target = sections[category]!;
    target.chunkIndexes.push(c.chunk_index);
    target.charCount += c.char_count;
    // 子节图片并入父分区图片集合
    for (const img of extractImages(c.content)) {
      if (!target.images.includes(img)) target.images.push(img);
    }
  }

  return {
    paperId: paper.id,
    title: paper.title,
    year: paper.year,
    hasZh: fs.existsSync(path.join(MD_TRANSLATION_DIR, `${paper.id}.zh.md`)),
    sections,
  };
}

export function buildOverview(): OverviewEntry[] {
  const papers = store.listPapers();
  const entries: OverviewEntry[] = [];

  for (const p of papers) {
    const chunks = db
      .prepare(
        `SELECT chunk_index, heading, content, char_count
         FROM chunks
         WHERE paper_id = ?
         ORDER BY chunk_index`,
      )
      .all(p.id) as { chunk_index: number; heading: string; content: string; char_count: number }[];
    if (chunks.length === 0) continue;
    entries.push(buildEntry(p, chunks));
  }

  return entries;
}
