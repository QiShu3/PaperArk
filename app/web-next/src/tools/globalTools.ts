import type { ChunkRow, Paper } from '@/types';
import { api } from '@/api';
import type { ToolDefinition, ToolHandler } from '@/tools';

export const GLOBAL_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_papers',
      description: '在论文库中按标题搜索相关论文',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_papers',
      description: '列出论文库中所有论文的标题、ID、标签和年份',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_paper_chunk',
      description: '获取指定论文的某个分段的完整内容',
      parameters: {
        type: 'object',
        properties: {
          paper_id: { type: 'string', description: '论文 ID（arXiv ID）' },
          target: { type: 'string', description: '分段标题全名或数字索引' },
        },
        required: ['paper_id', 'target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_paper_chunks',
      description: '列出指定论文的所有分段标题和索引',
      parameters: {
        type: 'object',
        properties: {
          paper_id: { type: 'string', description: '论文 ID（arXiv ID）' },
        },
        required: ['paper_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search_library',
      description: '按语义在整个论文库的分段中检索：适合概念性、跨语言（如中文问题查英文论文）的问题，返回最相关的论文与分段',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要检索的问题或概念描述（可以是中文）' },
        },
        required: ['query'],
      },
    },
  },
];

function findChunkByTarget(chunks: ChunkRow[], target: string): ChunkRow | null {
  const idx = Number(target);
  if (Number.isFinite(idx)) {
    return chunks.find((c) => c.chunk_index === idx) ?? null;
  }
  const lower = target.toLowerCase();
  return chunks.find((c) => c.heading.toLowerCase().includes(lower)) ?? null;
}

function formatChunk(c: ChunkRow): string {
  return `## ${c.heading}\n\n${c.content}`;
}

function formatChunkList(chunks: ChunkRow[]): string {
  return chunks
    .map((c) => `[${c.chunk_index}] ${c.heading} (${c.char_count} 字符)`)
    .join('\n');
}

function formatPaperList(papers: Paper[]): string {
  return papers
    .map((p) => {
      const tags = p.tags.length > 0 ? ` [${p.tags.join(', ')}]` : '';
      const venue = p.venue ? ` ${p.venue}` : '';
      const year = p.year ? ` ${p.year}` : '';
      return `- **${p.title}** (${p.id})${venue}${year}${tags}`;
    })
    .join('\n');
}

export function createGlobalToolHandlers(getCurrentDirection?: () => string): ToolHandler[] {
  const filterByDirection = (papers: Paper[]): Paper[] => {
    const dir = getCurrentDirection?.();
    if (!dir || dir === 'global') return papers;
    return papers.filter((p) => (p.directions ?? []).includes(dir));
  };

  const resolveChunks = async (id: string): Promise<ChunkRow[]> => {
    try {
      return await api.getChunks(id);
    } catch {
      return [];
    }
  };

  return [
    {
      definition: GLOBAL_TOOL_DEFINITIONS[0],
      execute: async (args) => {
        try {
          const results = await api.search(args.query);
          const visible = filterByDirection(results);
          if (visible.length === 0) return `在论文库中未找到与 "${args.query}" 相关的论文。`;
          return visible
            .map((r) => `- **${r.title}** (${r.id})`)
            .slice(0, 10)
            .join('\n');
        } catch {
          return '搜索论文库时出错。';
        }
      },
    },
    {
      definition: GLOBAL_TOOL_DEFINITIONS[1],
      execute: async () => {
        try {
          const papers = filterByDirection(await api.listPapers());
          const dir = getCurrentDirection?.();
          if (papers.length === 0) {
            return dir && dir !== 'global'
              ? `当前研究方向「${dir}」下暂无论文。`
              : '论文库中暂无论文。';
          }
          return `论文库中共 ${papers.length} 篇论文：\n\n${formatPaperList(papers)}`;
        } catch {
          return '获取论文列表时出错。';
        }
      },
    },
    {
      definition: GLOBAL_TOOL_DEFINITIONS[2],
      execute: async (args) => {
        const chunks = await resolveChunks(args.paper_id);
        if (chunks.length === 0) return `论文 ${args.paper_id} 没有分段数据。`;
        const c = findChunkByTarget(chunks, args.target);
        if (!c) return `在论文 ${args.paper_id} 中未找到分段 "${args.target}"。`;
        return `论文 ${args.paper_id} 的分段 [${c.chunk_index}] ${c.heading}:\n\n${formatChunk(c)}`;
      },
    },
    {
      definition: GLOBAL_TOOL_DEFINITIONS[3],
      execute: async (args) => {
        const chunks = await resolveChunks(args.paper_id);
        if (chunks.length === 0) return `论文 ${args.paper_id} 没有分段数据。`;
        return `论文 ${args.paper_id} 共有 ${chunks.length} 个分段：\n\n${formatChunkList(chunks)}`;
      },
    },
    {
      definition: GLOBAL_TOOL_DEFINITIONS[4],
      execute: async (args) => {
        try {
          const hits = await api.semanticSearchAll(args.query, 5);
          if (hits.length === 0) {
            return '未找到语义相关的论文分段（向量服务可能未启用，或论文库尚未向量化）。可改用 search_papers 标题搜索。';
          }
          return hits
            .map(
              (h, i) =>
                `[${i + 1}] **${h.paperId}** · ${h.heading}（相关度 ${h.score.toFixed(3)}）\n${h.content.slice(0, 280)}${
                  h.content.length > 280 ? '…' : ''
                }`,
            )
            .join('\n\n');
        } catch (e) {
          return `语义搜索失败：${e instanceof Error ? e.message : '未知错误'}。可改用 search_papers 标题搜索。`;
        }
      },
    },
  ];
}
