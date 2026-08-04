import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { remarkLatexDelimiters } from '@/lib/markdownPlugins';

function resolveImage(src?: string): string {
  if (!src) return '';
  if (/^https?:\/\//.test(src) || src.startsWith('/') || src.startsWith('data:')) return src;
  return `/MD/images/${src.replace(/^(\.\/)?images\//, '')}`;
}
import { Loader2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { api } from '@/api';
import type { ChunkRow } from '@/types';

interface Props {
  paperId: string;
  onActiveChunkChange?: (heading: string, content: string) => void;
}

export default function ChunkView({ paperId, onActiveChunkChange }: Props) {
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<ChunkRow[] | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .getChunks(paperId)
      .then((rows) => {
        setChunks(rows);
        setActiveIndex(0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载分段失败'))
      .finally(() => setLoading(false));
  }, [paperId]);

  const activeChunk = chunks[activeIndex];

  const nonEmpty = useMemo(() => chunks.filter((c) => c.char_count > 0), [chunks]);

  useEffect(() => {
    if (activeChunk) {
      onActiveChunkChange?.(activeChunk.heading, activeChunk.content);
    }
  }, [activeChunk, onActiveChunkChange]);

  const handleSearch = () => {
    const q = searchQ.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    api
      .getChunks(paperId, q)
      .then((rows) => setSearchResults(rows))
      .catch(() => setSearchResults([]));
  };

  const jumpTo = (chunk: ChunkRow) => {
    const idx = chunks.findIndex((c) => c.id === chunk.id);
    if (idx !== -1) setActiveIndex(idx);
    setSearchResults(null);
    setSearchQ('');
  };

  const prev = () => {
    if (activeIndex > 0) setActiveIndex((i) => i - 1);
  };

  const next = () => {
    if (activeIndex < chunks.length - 1) setActiveIndex((i) => i + 1);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (chunks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        暂无分段数据
      </div>
    );
  }

  const parentHeading = activeChunk?.parent_id
    ? chunks.find((c) => c.id === activeChunk.parent_id)?.heading
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {parentHeading && (
              <p className="text-xs text-muted-foreground">{parentHeading}</p>
            )}
            <h3 className="truncate text-sm font-semibold">{activeChunk?.heading}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <button
              onClick={prev}
              disabled={activeIndex === 0}
              className="rounded p-1 hover:bg-accent disabled:opacity-30"
              title="上一段"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="tabular-nums">
              {activeIndex + 1} / {chunks.length}
            </span>
            <button
              onClick={next}
              disabled={activeIndex === chunks.length - 1}
              className="rounded p-1 hover:bg-accent disabled:opacity-30"
              title="下一段"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div className="mt-2 flex gap-2">
          <select
            value={activeIndex}
            onChange={(e) => setActiveIndex(Number(e.target.value))}
            className="flex-1 rounded border bg-background px-2 py-1 text-xs text-muted-foreground"
          >
            {nonEmpty.map((c) => (
              <option key={c.id} value={c.chunk_index}>
                {c.heading}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 选项栏 */}
      <div className="shrink-0 border-b px-4 py-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="搜索分段..."
              className="w-full rounded border bg-background py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={handleSearch}
            className="rounded border px-3 py-1 text-xs hover:bg-accent"
          >
            搜索
          </button>
        </div>

        {searchResults !== null && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded border bg-muted/30">
            {searchResults.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">无匹配结果</p>
            ) : (
              searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => jumpTo(r)}
                  className="block w-full px-3 py-2 text-left text-xs hover:bg-accent"
                >
                  <span className="font-medium">{r.heading}</span>
                  <span className="ml-2 text-muted-foreground">
                    {r.content.slice(0, 80).replace(/\s+/g, ' ')}…
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* 正文栏 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {activeChunk?.content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_pre]:text-xs [&_table]:text-xs">
            <ReactMarkdown
              remarkPlugins={[remarkLatexDelimiters, remarkGfm, remarkMath]}
              rehypePlugins={[rehypeRaw, rehypeKatex]}
              components={{
                img: ({ src, alt }) => (
                  <img
                    src={resolveImage(src)}
                    alt={alt ?? ''}
                    loading="lazy"
                    className="max-w-full rounded-md border"
                  />
                ),
              }}
            >
              {activeChunk.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            此段无内容
          </div>
        )}
      </div>
    </div>
  );
}
