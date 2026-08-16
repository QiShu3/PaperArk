import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';

let app: Express;
let tempDir: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'papers-overview-test-'));
  process.env.PAPERS_ROOT = tempDir;
  process.env.VITEST = '1';

  mkdirSync(join(tempDir, 'MD'), { recursive: true });
  mkdirSync(join(tempDir, 'MD', 'images'), { recursive: true });
  mkdirSync(join(tempDir, 'rawPDF'), { recursive: true });

  // 论文 A：摘要 + 引言（含图片）+ 方法（含子节与图片）+ 实验 + 结论
  writeFileSync(
    join(tempDir, 'MD', 'paper-a.md'),
    [
      '# Paper A',
      '',
      '## Abstract',
      '',
      'Abstract text of A.',
      '',
      '## 1. Introduction',
      '',
      'Intro with image ![](images/intro.png).',
      '',
      '## 3. Methodology',
      '',
      'Method overview.',
      '',
      '## 3.1. Architecture',
      '',
      'Architecture diagram ![](images/arch.png).',
      '',
      '## 5. Experiments',
      '',
      'Experiments overview.',
      '',
      '## 5.1. Ablation study',
      '',
      'Ablation results ![](images/abl.png).',
      '',
      '## 6. Conclusion',
      '',
      'Conclusion text.',
      '',
      '## References',
      '',
      '[1] something',
      '',
      '## A. Experiment details',
      '',
      'Appendix details.',
      '',
    ].join('\n'),
  );

  // 论文 A 的中文翻译（标题结构与原版 1:1，含中文摘要）
  mkdirSync(join(tempDir, 'md-translations'), { recursive: true });
  writeFileSync(
    join(tempDir, 'md-translations', 'paper-a.zh.md'),
    [
      '# 论文A',
      '',
      '摘要——论文A的摘要。',
      '',
      '## 1. 引言',
      '',
      '带图片的引言 ![](images/intro.png)。',
      '',
      '## 3. 方法论',
      '',
      '方法概述。',
      '',
      '## 3.1. 架构',
      '',
      '架构图 ![](images/arch.png)。',
      '',
      '## 5. 实验',
      '',
      '实验概述。',
      '',
      '## 5.1. 消融实验',
      '',
      '消融结果 ![](images/abl.png)。',
      '',
      '## 6. 结论',
      '',
      '结论文本。',
      '',
      '## 参考文献',
      '',
      '[1] something',
      '',
      '## A. 实验细节',
      '',
      '附录细节。',
      '',
    ].join('\n'),
  );

  // 论文 B：无摘要（正文直接从引言开始），无图片
  writeFileSync(
    join(tempDir, 'MD', 'paper-b.md'),
    [
      '# Paper B',
      '',
      '## Introduction',
      '',
      'Intro text only.',
      '',
    ].join('\n'),
  );

  // 论文 C：只有 PDF 无 MD → 无 chunk，应被概览排除
  writeFileSync(join(tempDir, 'rawPDF', 'paper-c.pdf'), '%PDF-1.4 fake');

  const { createApp } = await import('../index.js');
  app = createApp();
});

afterAll(async () => {
  const { closeDb } = await import('../db.js');
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('GET /api/overview/sections', () => {
  it('returns aggregated section metadata for every paper with chunks', async () => {
    const res = await request(app).get('/api/overview/sections');
    expect(res.status).toBe(200);
    const { papers } = res.body as {
      papers: {
        paperId: string;
        title: string;
        sections: Record<string, { chunkIndex: number; heading: string; images: string[] }>;
      }[];
    };
    expect(Array.isArray(papers)).toBe(true);
    const ids = papers.map((p) => p.paperId);
    expect(ids).toContain('paper-a');
    expect(ids).toContain('paper-b');
    // PDF-only 论文没有 chunk，应被排除
    expect(ids).not.toContain('paper-c');
  });

  it('classifies sections and merges subsection images into the parent category', async () => {
    const res = await request(app).get('/api/overview/sections');
    const { papers } = res.body as {
      papers: {
        paperId: string;
        sections: Record<
          string,
          { chunkIndex: number; heading: string; images: string[]; chunkIndexes: number[] }
        >;
      }[];
    };
    const a = papers.find((p) => p.paperId === 'paper-a')!;

    // 摘要
    expect(a.sections.abstract).toBeDefined();
    expect(a.sections.abstract.heading).toBe('Abstract');
    expect(a.sections.abstract.chunkIndex).toBe(0);

    // 引言：编号前缀被归一化
    expect(a.sections.introduction).toBeDefined();
    expect(a.sections.introduction.images).toContain('images/intro.png');

    // 方法：顶级段 + 子节图片并入
    expect(a.sections.method).toBeDefined();
    expect(a.sections.method.heading).toBe('3. Methodology');
    expect(a.sections.method.images).toContain('images/arch.png');
    // 该分区全部 chunk（含子节 3.1. Architecture），供浏览页拼接完整内容
    expect(a.sections.method.chunkIndexes).toEqual([2, 3]);

    // 实验：子节「5.1. Ablation study」继承 experiments，图片并入
    expect(a.sections.experiments).toBeDefined();
    expect(a.sections.experiments.heading).toBe('5. Experiments');
    expect(a.sections.experiments.images).toContain('images/abl.png');
    expect(a.sections.experiments.chunkIndexes).toEqual([4, 5]);

    // 结论
    expect(a.sections.conclusion).toBeDefined();

    // References 与附录（A. Experiment details）不进入任何浏览分区
    expect(a.sections.other).toBeUndefined();
  });

  it('omits sections that a paper lacks (e.g. no Abstract)', async () => {
    const res = await request(app).get('/api/overview/sections');
    const { papers } = res.body as {
      papers: {
        paperId: string;
        sections: Record<string, unknown>;
      }[];
    };
    const b = papers.find((p) => p.paperId === 'paper-b')!;
    expect(b.sections.abstract).toBeUndefined();
    expect(b.sections.introduction).toBeDefined();
  });

  it('marks whether each paper has a Chinese translation', async () => {
    const res = await request(app).get('/api/overview/sections');
    const { papers } = res.body as {
      papers: { paperId: string; hasZh: boolean }[];
    };
    expect(papers.find((p) => p.paperId === 'paper-a')?.hasZh).toBe(true);
    expect(papers.find((p) => p.paperId === 'paper-b')?.hasZh).toBe(false);
  });
});

describe('GET /api/papers/:id/zh-chunks', () => {
  it('returns translated chunks aligned with the original by chunk_index', async () => {
    const res = await request(app).get('/api/papers/paper-a/zh-chunks');
    expect(res.status).toBe(200);
    const chunks = res.body as {
      chunk_index: number;
      heading: string;
      content: string;
    }[];
    // 与原版分块一一对应（9 块，含 Abstract）
    expect(chunks).toHaveLength(9);
    expect(chunks[0].heading).toBe('Abstract');
    expect(chunks[0].content).toBe('论文A的摘要。');
    expect(chunks[1].heading).toBe('1. 引言');
    expect(chunks[1].content).toContain('images/intro.png');
    expect(chunks[5].heading).toBe('5.1. 消融实验');
  });

  it('returns 404 when the paper has no translation', async () => {
    const res = await request(app).get('/api/papers/paper-b/zh-chunks');
    expect(res.status).toBe(404);
  });
});
