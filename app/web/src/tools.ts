import type { ChunkRow } from '@/types';
import { api } from '@/api';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export interface ToolHandler {
  definition: ToolDefinition;
  execute: (args: Record<string, string>) => Promise<string>;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_chunks',
      description: '在论文的分段中全文搜索关键词，返回匹配的段标题和内容摘要',
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
      name: 'get_chunk',
      description: '获取指定分段的完整内容。参数 target 可以是分段标题全名或数字索引',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: '分段标题全名（如 "Introduction"）或数字索引（如 "3"）' },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_chunk',
      description: '获取用户当前正在浏览的分段内容。不需要参数。分块模式专用',
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
      name: 'list_chunks',
      description: '列出当前论文所有分段的标题和索引。不需要参数',
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
      name: 'list_images',
      description: '列出当前论文中所有图片。每条以 Markdown 语法 ![]() 格式返回，回复时请直接嵌入此格式展示图片',
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

function formatChunkSnippets(chunks: ChunkRow[], query: string): string {
  const results = chunks.map((c) => {
    const idx = c.content.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return `[${c.chunk_index}] ${c.heading}: (匹配)`;
    const start = Math.max(0, idx - 40);
    const snippet = c.content.slice(start, idx + query.length + 80);
    return `[${c.chunk_index}] ${c.heading}: ...${snippet.replace(/\s+/g, ' ').trim()}...`;
  });
  return results.join('\n\n');
}

export function createToolHandlers(
  paperId: string,
  getCurrentChunk: () => { heading: string; content: string },
): ToolHandler[] {
  const resolveChunks = async (id: string): Promise<ChunkRow[]> => {
    try {
      return await api.getChunks(id);
    } catch {
      return [];
    }
  };

  return [
    {
      definition: TOOL_DEFINITIONS[0],
      execute: async (args) => {
        const chunks = await api.getChunks(paperId, args.query);
        if (chunks.length === 0) return `在论文中未找到与 "${args.query}" 相关的分段。`;
        return `在论文中找到 ${chunks.length} 个相关分段：\n\n${formatChunkSnippets(chunks, args.query)}`;
      },
    },
    {
      definition: TOOL_DEFINITIONS[1],
      execute: async (args) => {
        const chunks = await resolveChunks(paperId);
        const c = findChunkByTarget(chunks, args.target);
        if (!c) return `未找到分段 "${args.target}"。请用 list_chunks 查看所有分段列表。`;
        return `分段 [${c.chunk_index}] ${c.heading}:\n\n${formatChunk(c)}`;
      },
    },
    {
      definition: TOOL_DEFINITIONS[2],
      execute: async () => {
        const chunk = getCurrentChunk();
        if (!chunk.content) return '当前没有选中任何分段内容。';
        return `用户当前正在浏览：\n\n## ${chunk.heading}\n\n${chunk.content}`;
      },
    },
    {
      definition: TOOL_DEFINITIONS[3],
      execute: async () => {
        const chunks = await resolveChunks(paperId);
        if (chunks.length === 0) return '当前论文没有分段数据。';
        return `当前论文共有 ${chunks.length} 个分段：\n\n${formatChunkList(chunks)}`;
      },
    },
    {
      definition: TOOL_DEFINITIONS[4],
      execute: async () => {
        try {
          const { images } = await api.getImages(paperId);
          if (images.length === 0) return '当前论文中没有找到图片。';
          return `当前论文共 ${images.length} 张图片：\n${images.map((img, i) => `${i + 1}. ![](${img})`).join('\n')}`;
        } catch {
          return '无法获取图片列表。';
        }
      },
    },
    {
      definition: TOOL_DEFINITIONS[5],
      execute: async (args) => {
        try {
          const results = await api.search(args.query);
          if (results.length === 0) return `在论文库中未找到与 "${args.query}" 相关的论文。`;
          return results
            .map((r) => `- **${r.title}** (${r.id})`)
            .slice(0, 10)
            .join('\n');
        } catch {
          return '搜索论文库时出错。';
        }
      },
    },
    {
      definition: TOOL_DEFINITIONS[6],
      execute: async (args) => {
        const chunks = await resolveChunks(args.paper_id);
        if (chunks.length === 0) return `论文 ${args.paper_id} 没有分段数据。`;
        const c = findChunkByTarget(chunks, args.target);
        if (!c) return `在论文 ${args.paper_id} 中未找到分段 "${args.target}"。`;
        return `论文 ${args.paper_id} 的分段 [${c.chunk_index}] ${c.heading}:\n\n${formatChunk(c)}`;
      },
    },
    {
      definition: TOOL_DEFINITIONS[7],
      execute: async (args) => {
        const chunks = await resolveChunks(args.paper_id);
        if (chunks.length === 0) return `论文 ${args.paper_id} 没有分段数据。`;
        return `论文 ${args.paper_id} 共有 ${chunks.length} 个分段：\n\n${formatChunkList(chunks)}`;
      },
    },
  ];
}
