import { describe, it, expect } from 'vitest';
import {
  classifyHeading,
  isSubsectionHeading,
  CATEGORY_LABELS,
  type SectionCategory,
} from '../sections.js';

describe('classifyHeading', () => {
  const cases: [string, SectionCategory][] = [
    // 摘要
    ['Abstract', 'abstract'],
    ['ABSTRACT', 'abstract'],
    ['## Abstract', 'abstract'], // 头部残留（正常不会出现，防御）
    // 引言：编号 / 罗马数字 / 无编号
    ['1 Introduction', 'introduction'],
    ['1. Introduction', 'introduction'],
    ['I. INTRODUCTION', 'introduction'],
    ['Introduction', 'introduction'],
    // 相关工作
    ['2. Related work', 'related'],
    ['II. RELATED WORK', 'related'],
    ['2 Related Works', 'related'],
    ['2. Background', 'related'],
    // 方法：各种同义表达
    ['3 Methodology', 'method'],
    ['4. The proposed method', 'method'],
    ['3 Method', 'method'],
    ['Method', 'method'],
    ['3.1 System Overview', 'method'],
    ['Proposed Approach', 'method'],
    ['4. Framework', 'method'],
    ['3 Threat Model', 'method'],
    // MinerU 在标题里插入的 <sub>/<sup> 标签
    ['Ab<sub>s</sub>t<sub>rac</sub>t', 'abstract'],
    ['4 D<sub>es</sub>i<sub>gn</sub> <sub>o</sub>f M<sub>ir</sub>ag<sub>e</sub> F<sub>ramewor</sub>k', 'method'],
    // Preliminaries 归入相关工作/背景
    ['2 Preliminaries', 'related'],
    ['II. PRELIMINARIES', 'related'],
    // 实验
    ['4 Experiments', 'experiments'],
    ['4. Experiments', 'experiments'],
    ['IV. EXPERIMENTS', 'experiments'],
    ['5. Evaluation', 'experiments'],
    ['Experimental setup', 'experiments'],
    ['Results', 'experiments'],
    ['5.1 Ablation study', 'experiments'],
    ['Empirical evaluation', 'experiments'],
    // 结论
    ['5 Conclusion', 'conclusion'],
    ['6. Conclusion', 'conclusion'],
    ['V. CONCLUSION', 'conclusion'],
    ['Summary', 'conclusion'],
    // 非内容段
    ['References', 'other'],
    ['Acknowledgements', 'other'],
    ['Appendix', 'other'],
    ['Guidelines:', 'other'],
    ['Prompts', 'other'],
    // 附录式（单字母 + 点，优先排除）
    ['A. Experiment details', 'other'],
    ['B. Physical experiments', 'other'],
    // 未知
    ['Random heading', 'other'],
    ['', 'other'],
  ];

  for (const [heading, expected] of cases) {
    it(`classifies "${heading}" → ${expected}`, () => {
      expect(classifyHeading(heading)).toBe(expected);
    });
  }
});

describe('isSubsectionHeading', () => {
  it('detects numbered subsections', () => {
    expect(isSubsectionHeading('2.1. Digital adversarial example')).toBe(true);
    expect(isSubsectionHeading('5.3 User study')).toBe(true);
    expect(isSubsectionHeading('3.1.2 Deep')).toBe(true);
    // MinerU 标签内嵌的编号
    expect(isSubsectionHeading('2<sub>.</sub>1 P<sub>e</sub>rception')).toBe(true);
  });

  it('does not treat top-level or non-numbered headings as subsections', () => {
    expect(isSubsectionHeading('2. Related work')).toBe(false);
    expect(isSubsectionHeading('Experiments')).toBe(false);
    expect(isSubsectionHeading('References')).toBe(false);
  });
});

describe('CATEGORY_LABELS', () => {
  it('has a Chinese label for every category', () => {
    const categories: SectionCategory[] = [
      'abstract',
      'introduction',
      'related',
      'method',
      'experiments',
      'conclusion',
      'other',
    ];
    for (const c of categories) {
      expect(CATEGORY_LABELS[c]).toBeTruthy();
    }
  });
});
