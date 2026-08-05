import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { api } from '../api';
import type { Paper } from '../types';
import { useDirection, GLOBAL_DIRECTION } from '../context/DirectionContext';
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
            {paper.addedAt && (
              <span className="inline-flex items-center gap-0.5">
                <Calendar className="size-3" />
                {formatDate(paper.addedAt)}
              </span>
            )}
            {paper.source === 'arxiv-auto' && <Badge variant="outline">自动收录</Badge>}
            {!paper.hasMd && <Badge variant="outline">无 MD</Badge>}
            {paper.directions?.map((d) => (
              <Badge key={d} variant="secondary" className="text-[10px]">
                {d}
              </Badge>
            ))}
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

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return '';
  }
}

type SortKey = 'addedDesc' | 'addedAsc' | 'yearDesc' | 'yearAsc' | 'titleAsc';

function sortPapers(list: Paper[], sortBy: SortKey): Paper[] {
  const arr = [...list];
  const addedOf = (p: Paper): number | undefined =>
    p.addedAt ? Date.parse(p.addedAt) : undefined;
  const yearOf = (p: Paper): number | undefined =>
    p.year && !Number.isNaN(Number(p.year)) ? Number(p.year) : undefined;
  const cmpNum = (a?: number, b?: number): number => {
    if (a === b) return 0;
    if (a === undefined) return 1; // 缺失字段排最后
    if (b === undefined) return -1;
    return a - b;
  };

  switch (sortBy) {
    case 'addedAsc':
      arr.sort((a, b) => cmpNum(addedOf(a), addedOf(b)));
      break;
    case 'yearDesc':
      arr.sort((a, b) => cmpNum(yearOf(b), yearOf(a)));
      break;
    case 'yearAsc':
      arr.sort((a, b) => cmpNum(yearOf(a), yearOf(b)));
      break;
    case 'titleAsc':
      arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
      break;
    default:
      arr.sort((a, b) => cmpNum(addedOf(b), addedOf(a)));
  }
  return arr;
}

export default function PaperList() {
  const navigate = useNavigate();
  const { direction } = useDirection();
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
  const [autoOnly, setAutoOnly] = useState(false);
  const [yearFilter, setYearFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('addedDesc');
  const [uploadOpen, setUploadOpen] = useState(false);

  const papersQ = useQuery({ queryKey: ['papers'], queryFn: api.listPapers });
  const tagsQ = useQuery({ queryKey: ['tags'], queryFn: api.listTags });
  const researchQ = useQuery({ queryKey: ['research-config'], queryFn: api.getResearchConfig });

  const searching = query.trim().length >= 2;
  const searchQ = useQuery({
    queryKey: ['search', query.trim()],
    queryFn: () => api.search(query.trim()),
    enabled: searching,
  });

  const baseList = searching ? (searchQ.data ?? []) : (papersQ.data ?? []);
  const activeDirection =
    direction !== GLOBAL_DIRECTION &&
    (researchQ.data?.directions.some((d) => d.name === direction) ?? false)
      ? direction
      : GLOBAL_DIRECTION;

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const p of papersQ.data ?? []) {
      if (p.year) set.add(p.year);
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [papersQ.data]);

  const venueCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of papersQ.data ?? []) {
      if (!p.venue) continue;
      map.set(p.venue, (map.get(p.venue) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
  }, [papersQ.data]);

  const filtered = useMemo(() => {
    return baseList.filter(
      (p) =>
        (activeDirection === GLOBAL_DIRECTION || (p.directions ?? []).includes(activeDirection)) &&
        (!yearFilter || p.year === yearFilter) &&
        (!selectedVenues.length || (p.venue && selectedVenues.includes(p.venue))) &&
        (!autoOnly || p.source === 'arxiv-auto') &&
        selectedTags.every((t) => p.tags.includes(t)),
    );
  }, [baseList, selectedTags, selectedVenues, autoOnly, activeDirection, yearFilter]);

  const sorted = useMemo(() => sortPapers(filtered, sortBy), [filtered, sortBy]);

  const toggleTag = (t: string) =>
    setSelectedTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const toggleVenue = (v: string) =>
    setSelectedVenues((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  const loading = papersQ.isLoading || (searching && searchQ.isLoading);
  const error = papersQ.error || (searching ? searchQ.error : null);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {activeDirection === GLOBAL_DIRECTION ? 'Papers 知识库' : activeDirection}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              共 {filtered.length} 篇论文
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate('/chat')}>
              <MessageSquare /> 全局对话
            </Button>
            <Button variant="outline" onClick={() => navigate('/research')}>
              <RefreshCw /> 研究方向
            </Button>
            <Button onClick={() => setUploadOpen(true)}>
              <Plus /> 新增论文
            </Button>
          </div>
        </header>

        <div className="mt-6 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
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
          </div>

          <div className="flex flex-wrap items-start gap-2">
            <div className="flex w-3/4 min-w-0 flex-wrap gap-1.5">
              <Badge
                variant={autoOnly ? 'default' : 'outline'}
                className="cursor-pointer select-none px-2.5 py-1 text-sm"
                onClick={() => setAutoOnly((v) => !v)}
              >
                自动收录
              </Badge>
              {venueCounts.map(([v, count]) => {
                const active = selectedVenues.includes(v);
                return (
                  <Badge
                    key={v}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer select-none px-2.5 py-1 text-sm"
                    onClick={() => toggleVenue(v)}
                  >
                    {v}
                    <span className="ml-1 opacity-60">{count}</span>
                  </Badge>
                );
              })}
              {(tagsQ.data?.length ?? 0) > 0 &&
                tagsQ.data!.map((t) => {
                  const active = selectedTags.includes(t.tag);
                  return (
                    <Badge
                      key={t.tag}
                      variant={active ? 'default' : 'outline'}
                      className="cursor-pointer select-none px-2.5 py-1 text-sm"
                      onClick={() => toggleTag(t.tag)}
                    >
                      {t.tag}
                      <span className="ml-1 opacity-60">{t.count}</span>
                    </Badge>
                  );
                })}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                aria-label="按年份筛选"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">全部年份</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                aria-label="排序方式"
                className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="addedDesc">最新收录</option>
                <option value="addedAsc">最早收录</option>
                <option value="yearDesc">年份最新</option>
                <option value="yearAsc">年份最早</option>
                <option value="titleAsc">标题 A-Z</option>
              </select>
            </div>
          </div>
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
              {searching || selectedTags.length > 0 || selectedVenues.length > 0
                ? '没有匹配的论文'
                : '知识库暂无论文,点击右上角新增'}
            </p>
          )}

          {!loading &&
            !error &&
            sorted.map((p) => <PaperRow key={p.id} paper={p} />)}
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
