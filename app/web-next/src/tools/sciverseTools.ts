import { api } from '@/api';
import type { ToolDefinition, ToolHandler } from '@/tools';

export const SCIVERSE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'sciverse_semantic_search',
      description:
        '用自然语言在 Sciverse 全球文献库做语义检索，返回最相关的段落、论文标题与引用定位（doc_id/offset/页码）。适合概念性、开放式问题，如「最近扩散模型对抗攻击有什么进展」。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '研究问题或概念描述（支持中文）' },
          top_k: { type: 'string', description: '返回段落数，默认 10，最大 20' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sciverse_search_papers',
      description: '在 Sciverse 按标题/作者/年份做结构化检索，精确定位某篇论文（如给定 DOI、作者名、发表年份）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '标题关键词或论文主题' },
          authors: { type: 'string', description: '作者名，多个用逗号分隔' },
          year_from: { type: 'string', description: '起始发表年份，如 2020' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sciverse_read_content',
      description:
        '按 doc_id 读取 Sciverse 论文的全文切片（默认约 4096 字符）。需要溯源、精读某篇论文时调用；返回 next_offset 与 more，如内容未完可继续传 offset 读取后续。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: 'Sciverse 文档 ID（来自语义/结构化检索结果）' },
          offset: { type: 'string', description: '字符偏移量，默认 0' },
          limit: { type: 'string', description: '本次读取最大字符数，默认 4096' },
        },
        required: ['doc_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sciverse_relations',
      description: '查看某篇论文的引用关系：CITATIONS（谁引用了它）/ REFERENCES（它引用了谁）/ RELATED_WORKS（相关工作）。',
      parameters: {
        type: 'object',
        properties: {
          unique_id: { type: 'string', description: '论文的 unique_id（来自检索结果，形如 paper:10.xxxx/xx）' },
          relation: { type: 'string', description: 'CITATIONS / REFERENCES / RELATED_WORKS' },
        },
        required: ['unique_id', 'relation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sciverse_get_resource',
      description:
        '获取 Sciverse 论文中图表等附件的可访问 URL。传入 read_content 返回的 Markdown 中的图片路径（如 dt=xxx/p_yyy/f3.png），返回可展示的图片地址。',
      parameters: {
        type: 'object',
        properties: {
          file_name: { type: 'string', description: '资源相对路径（read_content 返回的 Markdown 图片路径）' },
        },
        required: ['file_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sciverse_add_favorite',
      description:
        '把某篇论文收藏到 Sciverse 收藏夹（只存元数据，不下载全文）。当用户说「收藏」「收进收藏夹」「收藏这篇」时调用，需要提供 doc_id 与标题。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: { type: 'string', description: '论文的 doc_id（来自检索结果）' },
          title: { type: 'string', description: '论文标题' },
          doi: { type: 'string', description: 'DOI（如有）' },
          year: { type: 'string', description: '发表年份（如有）' },
        },
        required: ['doc_id', 'title'],
      },
    },
  },
];

function formatSemanticHits(hits: Awaited<ReturnType<typeof api.sciverseSemanticSearch>>['hits']): string {
  if (hits.length === 0) return '未找到相关文献。';
  return hits
    .map((h, i) => {
      const src = h.source ?? {};
      const meta = [src.year, src.venue].filter(Boolean).join(' · ');
      return (
        `[${i + 1}] **${h.title || src.title || '未知标题'}**${meta ? ` (${meta})` : ''} 相关度 ${(h.score ?? 0).toFixed(3)}` +
        `\ndoc_id: ${h.doc_id ?? '-'} | offset: ${h.offset ?? '-'}${h.page_no != null ? ` | page: ${h.page_no}` : ''}` +
        `${h.citation_count != null ? ` | 被引 ${h.citation_count}` : ''}` +
        `\n${(h.text ?? '').slice(0, 500)}${(h.text ?? '').length > 500 ? '…' : ''}`
      );
    })
    .join('\n\n');
}

function formatPaperHits(hits: Awaited<ReturnType<typeof api.sciverseSearchPapers>>['hits']): string {
  if (hits.length === 0) return '未找到匹配的论文。';
  return hits
    .map((h, i) => {
      const meta = [h.year, h.venue].filter(Boolean).join(' · ');
      return (
        `[${i + 1}] **${h.title || '未知标题'}**${meta ? ` (${meta})` : ''}` +
        `\ndoc_id: ${h.doc_id ?? '-'} | unique_id: ${h.unique_id ?? '-'}` +
        `${h.doi ? ` | DOI: ${h.doi}` : ''}` +
        `${h.citation_count != null ? ` | 被引 ${h.citation_count}` : ''}` +
        `${h.is_content_accessible === true ? '' : ' | 无全文'}` +
        `${h.authors?.length ? `\n作者: ${h.authors.join(', ')}` : ''}` +
        `${h.abstract ? `\n摘要: ${h.abstract.slice(0, 300)}${h.abstract.length > 300 ? '…' : ''}` : ''}`
      );
    })
    .join('\n\n');
}

export function createSciverseToolHandlers(): ToolHandler[] {
  return [
    {
      definition: SCIVERSE_TOOL_DEFINITIONS[0],
      execute: async (args) => {
        try {
          const topK = Math.min(20, Math.max(1, Number(args.top_k) || 10));
          const { hits } = await api.sciverseSemanticSearch(args.query, topK);
          return `语义检索「${args.query}」结果：\n\n${formatSemanticHits(hits)}\n\n如需精读某篇，可继续用 sciverse_read_content 读取其 doc_id。`;
        } catch (e) {
          return `语义检索失败：${e instanceof Error ? e.message : '未知错误'}。若提示配置 Sciverse Token，请先在设置中填写。`;
        }
      },
    },
    {
      definition: SCIVERSE_TOOL_DEFINITIONS[1],
      execute: async (args) => {
        try {
          const { hits } = await api.sciverseSearchPapers({
            query: args.query || undefined,
            authors: args.authors ? args.authors.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined,
            year_from: args.year_from ? Number(args.year_from) : undefined,
            page_size: 10,
          });
          return `结构化检索结果：\n\n${formatPaperHits(hits)}\n\n如需读全文，对 doc_id 调用 sciverse_read_content。`;
        } catch (e) {
          return `检索失败：${e instanceof Error ? e.message : '未知错误'}。`;
        }
      },
    },
    {
      definition: SCIVERSE_TOOL_DEFINITIONS[2],
      execute: async (args) => {
        try {
          const offset = Math.max(0, Number(args.offset) || 0);
          const limit = Math.min(100_000, Math.max(1, Number(args.limit) || 4096));
          const slice = await api.sciverseContent(args.doc_id, offset, limit);
          const tail = slice.more
            ? `\n\n（内容未完，next_offset=${slice.next_offset}，可继续调用 sciverse_read_content 传 offset=${slice.next_offset} 读取后续）`
            : '';
          return slice.text.slice(0, 8000) + tail;
        } catch (e) {
          return `读取全文失败：${e instanceof Error ? e.message : '未知错误'}（该论文可能无全文或 doc_id 无效）。`;
        }
      },
    },
    {
      definition: SCIVERSE_TOOL_DEFINITIONS[3],
      execute: async (args) => {
        try {
          const relation = String(args.relation ?? 'CITATIONS').toUpperCase();
          const { items, totalCount } = await api.sciverseRelations(args.unique_id, relation);
          if (items.length === 0) return `未找到该论文的${relation}关系。`;
          const label = { CITATIONS: '引用该论文的文献', REFERENCES: '该论文引用的文献', RELATED_WORKS: '相关工作' }[relation] ?? relation;
          return `「${label}」共 ${totalCount} 条，当前显示 ${items.length} 条：\n\n${items
            .map((it, i) => `[${i + 1}] ${it.title || it.id || '-'}${it.id_type ? ` (${it.id_type}: ${it.id})` : ''}`)
            .join('\n')}`;
        } catch (e) {
          return `查询引用关系失败：${e instanceof Error ? e.message : '未知错误'}。`;
        }
      },
    },
    {
      definition: SCIVERSE_TOOL_DEFINITIONS[4],
      execute: async (args) => {
        try {
          const url = api.sciverseResourceUrl(args.file_name);
          return `资源可访问：\n\n![](${url})`;
        } catch (e) {
          return `获取资源失败：${e instanceof Error ? e.message : '未知错误'}。`;
        }
      },
    },
    {
      definition: SCIVERSE_TOOL_DEFINITIONS[5],
      execute: async (args) => {
        try {
          const fav = await api.sciverseAddFavorite({
            doc_id: args.doc_id,
            title: args.title,
            doi: args.doi || undefined,
            year: args.year || undefined,
          });
          return `已收藏「${fav.title}」到 Sciverse 收藏夹（doc_id: ${fav.doc_id}）。`;
        } catch (e) {
          return `收藏失败：${e instanceof Error ? e.message : '未知错误'}。`;
        }
      },
    },
  ];
}
