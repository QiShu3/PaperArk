import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, Loader2, MessageSquare, Plus, Search } from 'lucide-react';
import { api } from '../api';
import type { Paper } from '../types';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import UploadDialog from '../components/UploadDialog';

function PaperRow({ paper }: { paper: Paper & { snippet?: string } }) {
  return (
    <Card className="p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            to={`/paper/${paper.id}`}
            className="line-clamp-2 font-semibold leading-snug hover:underline"
          >
            {paper.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">{paper.id}</span>
            {paper.venue && (
              <span className="inline-flex items-center gap-0.5 rounded bg-muted/50 px-1 py-0.5">
                {paper.venue}{paper.year ? ` ${paper.year}` : ''}
              </span>
            )}
            {paper.area && (
              <span className="text-muted-foreground/70">{paper.area}</span>
            )}
            {!paper.hasMd && <Badge variant="outline">无 MD</Badge>}
            {paper.snippet && (
              <span className="line-clamp-1 italic text-muted-foreground">{paper.snippet}</span>
            )}
          </div>
          {paper.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {paper.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
          <a
            href={`https://arxiv.org/abs/${paper.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3.5" /> arXiv
          </a>
          {paper.hasPdf && (
            <a
              href={`/rawPDF/${paper.id}.pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <FileText className="size-3.5" /> PDF
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function PaperList() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  const papersQ = useQuery({ queryKey: ['papers'], queryFn: api.listPapers });
  const tagsQ = useQuery({ queryKey: ['tags'], queryFn: api.listTags });

  const searching = query.trim().length >= 2;
  const searchQ = useQuery({
    queryKey: ['search', query.trim()],
    queryFn: () => api.search(query.trim()),
    enabled: searching,
  });

  const baseList = searching ? (searchQ.data ?? []) : (papersQ.data ?? []);
  const filtered = useMemo(() => {
    if (selectedTags.length === 0) return baseList;
    return baseList.filter((p) => selectedTags.every((t) => p.tags.includes(t)));
  }, [baseList, selectedTags]);

  const toggleTag = (t: string) =>
    setSelectedTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const loading = papersQ.isLoading || (searching && searchQ.isLoading);
  const error = papersQ.error || (searching ? searchQ.error : null);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Papers 知识库</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              共 {papersQ.data?.length ?? 0} 篇论文
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/chat')}>
              <MessageSquare /> 全局对话
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Plus /> 新增论文
            </Button>
          </div>
        </header>

        <div className="mt-6 flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题或正文(至少 2 个字符)…"
              className="pl-8"
            />
            {searching && searchQ.isLoading && (
              <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {(tagsQ.data?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tagsQ.data!.map((t) => {
                const active = selectedTags.includes(t.tag);
                return (
                  <Badge
                    key={t.tag}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer select-none"
                    onClick={() => toggleTag(t.tag)}
                  >
                    {t.tag}
                    <span className="ml-1 opacity-60">{t.count}</span>
                  </Badge>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-3">
          {loading &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}

          {!loading && error && (
            <p className="py-8 text-center text-sm text-destructive">
              加载失败:{error instanceof Error ? error.message : '未知错误'}
            </p>
          )}

          {!loading && !error && filtered.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {searching || selectedTags.length > 0 ? '没有匹配的论文' : '知识库暂无论文,点击右上角新增'}
            </p>
          )}

          {!loading &&
            !error &&
            filtered.map((p) => <PaperRow key={p.id} paper={p} />)}
        </div>
      </div>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onCreated={(id) => navigate(`/paper/${id}`)}
      />
    </div>
  );
}
