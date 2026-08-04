import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileText, Loader2, Search, X } from 'lucide-react';
import { api } from '@/api';
import type { Paper } from '@/types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';

interface ToolSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onInsertReference: (text: string) => void;
}

export default function ToolSidebar({
  collapsed,
  onToggle,
  onInsertReference,
}: ToolSidebarProps) {
  const [query, setQuery] = useState('');

  const papersQ = useQuery({ queryKey: ['papers'], queryFn: api.listPapers });
  const searching = query.trim().length >= 2;
  const searchQ = useQuery({
    queryKey: ['search', query.trim()],
    queryFn: () => api.search(query.trim()),
    enabled: searching,
  });

  const papers = searching ? (searchQ.data ?? []) : (papersQ.data ?? []);
  const loading = papersQ.isLoading || (searching && searchQ.isLoading);

  const handleInsert = (paper: Paper) => {
    const ref = `[${paper.title}](${paper.id})`;
    onInsertReference(ref);
  };

  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-l bg-muted/30 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          title="展开论文面板"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-64 flex-col border-l bg-muted/30">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">论文库</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          title="收起论文面板"
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索论文..."
            className="h-8 pl-8 text-xs"
          />
          {query && (
            <button
              className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Paper List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center pt-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : papers.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-8 text-xs text-muted-foreground">
            <FileText className="mb-2 size-6 opacity-40" />
            <p>{searching ? '没有匹配的论文' : '暂无论文'}</p>
          </div>
        ) : (
          papers.map((paper) => (
            <div
              key={paper.id}
              className="group mb-2 cursor-pointer rounded-md border bg-background p-2 transition-shadow hover:shadow-sm"
              onClick={() => handleInsert(paper)}
            >
              <p className="line-clamp-2 text-xs font-medium leading-snug">
                {paper.title}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {paper.id}
                </span>
                {paper.venue && (
                  <span className="text-[10px] text-muted-foreground">
                    {paper.venue}
                  </span>
                )}
                {paper.year && (
                  <span className="text-[10px] text-muted-foreground">
                    {paper.year}
                  </span>
                )}
              </div>
              {paper.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {paper.tags.slice(0, 3).map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] px-1 py-0">
                      {t}
                    </Badge>
                  ))}
                  {paper.tags.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{paper.tags.length - 3}
                    </span>
                  )}
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                <span>点击插入引用</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t p-2">
        <p className="text-center text-[10px] text-muted-foreground">
          共 {papers.length} 篇论文
        </p>
      </div>
    </div>
  );
}
