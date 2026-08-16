/**
 * 论文分区分类器：把 chunk 标题归一化为跨论文统一的浏览分区。
 *
 * 现有 chunk 按 `##`（H2）切分，标题风格差异很大（编号 / 罗马数字 / 同义词），
 * 这里用启发式规则把标题映射到 SectionCategory，供「快速浏览」跨论文聚合使用。
 * 纯函数，无 IO。
 */

export type SectionCategory =
  | 'abstract'
  | 'introduction'
  | 'related'
  | 'method'
  | 'experiments'
  | 'conclusion'
  | 'other';

export const SECTION_CATEGORIES: SectionCategory[] = [
  'abstract',
  'introduction',
  'related',
  'method',
  'experiments',
  'conclusion',
  'other',
];

/** 中文标签，供前端筛选与展示。 */
export const CATEGORY_LABELS: Record<SectionCategory, string> = {
  abstract: '摘要',
  introduction: '引言',
  related: '相关工作',
  method: '方法',
  experiments: '实验',
  conclusion: '结论',
  other: '其他',
};

/** 非内容段标题（不参与浏览分区）。 */
const NON_CONTENT_RE =
  /^(references|bibliography|acknowledg(e)?ment(s)?|appendix|guidelines?\s*:?|prompts?|ethics statement|data availability|code availability|supplementary|supplemental)/i;

/** MinerU 会在标题里插入 <sub>/<sup> 标签（如 "Ab<sub>s</sub>t<sub>rac</sub>t"），匹配前先剥掉。 */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/** 附录式标题：`A. Experiment details` / `B. Physical experiments` 等（单字母 + 点）。
 *  排除罗马数字字母 I/V/X（`I. INTRODUCTION`、`V. CONCLUSION` 是编号而非附录）。 */
const APPENDIX_RE = /^[A-HJ-UW-Za-hj-uw-z]\.\s+/;

/** 编号前缀：`1` / `1.` / `1.2` / `1.2.3` / `IV` / `IV.` 等。 */
const NUMBER_PREFIX_RE = /^(?:\d+(?:\.\d+)*|I{1,3}|IV|V|VI|IX|X)\.?\s+/;

/** 子节标题：`2.1.` / `5.3` 等数字编号，用于继承顶级分区。 */
export const SUBSECTION_RE = /^\d+\.\d+(?:\.\d+)*\.?\s*/;

const KEYWORDS: Record<Exclude<SectionCategory, 'other'>, string[]> = {
  abstract: ['abstract'],
  introduction: ['introduction', 'intro'],
  related: ['related work', 'related works', 'background', 'preliminar'],
  method: [
    'method',
    'methodology',
    'approach',
    'framework',
    'system overview',
    'proposed',
    'design',
    'model architecture',
    'architecture',
    'threat model',
  ],
  experiments: ['experiment', 'evaluation', 'results', 'empirical', 'performance', 'implementation detail', 'ablation'],
  conclusion: ['conclusion', 'summary'],
};

export function classifyHeading(heading: string): SectionCategory {
  const trimmed = stripHtml(heading.trim());
  if (!trimmed) return 'other';

  // 非内容段（References / Acknowledgments / 附录 / 使用指南等）直接排除
  if (NON_CONTENT_RE.test(trimmed)) return 'other';
  // 附录式标题（A./B./C. …）优先排除，避免 "A. Experiment details" 误归入实验
  if (APPENDIX_RE.test(trimmed)) return 'other';

  // 去掉编号前缀后做关键词匹配
  const text = trimmed.replace(NUMBER_PREFIX_RE, '').toLowerCase();
  if (!text) return 'other';

  for (const [category, words] of Object.entries(KEYWORDS) as [
    Exclude<SectionCategory, 'other'>,
    string[],
  ][]) {
    if (words.some((w) => text.includes(w))) return category;
  }
  return 'other';
}

/**
 * 判断标题是否为子节编号（如 `2.1.` / `5.3`）。
 * 聚合时子节继承该论文最近一个顶级分区的类别。
 */
export function isSubsectionHeading(heading: string): boolean {
  return SUBSECTION_RE.test(stripHtml(heading.trim()));
}
