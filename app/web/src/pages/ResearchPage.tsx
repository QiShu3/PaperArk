import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api';
import type {
  ResearchDirection,
  ResearchPaperStatus,
  ResearchRunDirection,
  ClassifyStatus,
} from '../types';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { useDirection, GLOBAL_DIRECTION } from '../context/DirectionContext';

const STATUS_LABEL: Record<ResearchPaperStatus, string> = {
  added: '已入库',
  duplicate: '已存在',
  download_failed: '下载失败',
  parse_failed: '解析失败',
  previously_failed: '曾失败',
};

const STATUS_VARIANT: Record<ResearchPaperStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  added: 'default',
  duplicate: 'secondary',
  download_failed: 'destructive',
  parse_failed: 'destructive',
  previously_failed: 'outline',
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function directionCounts(dir: ResearchRunDirection): Record<ResearchPaperStatus, number> {
  const counts: Record<ResearchPaperStatus, number> = {
    added: 0,
    duplicate: 0,
    download_failed: 0,
    parse_failed: 0,
    previously_failed: 0,
  };
  for (const p of dir.papers) counts[p.status] += 1;
  return counts;
}

export default function ResearchPage() {
  const qc = useQueryClient();
  const { direction, setDirection } = useDirection();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResearchDirection | null>(null);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [maxPerRun, setMaxPerRun] = useState('');

  const cfgQ = useQuery({ queryKey: ['research-config'], queryFn: api.getResearchConfig });
  const statusQ = useQuery({
    queryKey: ['research-status'],
    queryFn: api.getResearchStatus,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
  });
  const runsQ = useQuery({ queryKey: ['research-runs'], queryFn: api.getResearchRuns });
  const classifyQ = useQuery({
    queryKey: ['research-classify'],
    queryFn: api.getClassifyStatus,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
  });

  const openCreate = () => {
    setEditing(null);
    setName('');
    setQuery('');
    setEnabled(true);
    setMaxPerRun('');
    setDialogOpen(true);
  };

  const openEdit = (d: ResearchDirection) => {
    setEditing(d);
    setName(d.name);
    setQuery(d.query);
    setEnabled(d.enabled);
    setMaxPerRun(d.maxPerRun?.toString() ?? '');
    setDialogOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: (d: { name: string; query: string; enabled: boolean; maxPerRun?: number }) =>
      editing
        ? api.updateResearchDirection(editing.name, {
            query: d.query,
            enabled: d.enabled,
            maxPerRun: d.maxPerRun,
          })
        : api.createResearchDirection(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-config'] });
      setDialogOpen(false);
      toast.success(editing ? '研究方向已更新' : '研究方向已添加');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '保存失败'),
  });

  const toggleMut = useMutation({
    mutationFn: (d: ResearchDirection) => api.updateResearchDirection(d.name, { enabled: !d.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-config'] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : '操作失败'),
  });

  const deleteMut = useMutation({
    mutationFn: (directionName: string) => api.deleteResearchDirection(directionName),
    onSuccess: (_data, directionName) => {
      qc.invalidateQueries({ queryKey: ['research-config'] });
      if (directionName === direction) setDirection(GLOBAL_DIRECTION);
      toast.success('研究方向已删除');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  });

  const checkMut = useMutation({
    mutationFn: api.checkResearch,
    onSuccess: () => {
      toast.success('已开始自动检查，完成后可查看运行历史');
      qc.invalidateQueries({ queryKey: ['research-status'] });
      qc.invalidateQueries({ queryKey: ['research-runs'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '启动检查失败'),
  });

  const classifyMut = useMutation({
    mutationFn: api.startClassify,
    onSuccess: () => {
      toast.success('已开始对已有论文进行分类');
      qc.invalidateQueries({ queryKey: ['research-classify'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '启动分类失败'),
  });

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedQuery = query.trim();
    if (!trimmedName || !trimmedQuery) {
      toast.error('名称和查询词不能为空');
      return;
    }
    saveMut.mutate({
      name: trimmedName,
      query: trimmedQuery,
      enabled,
      maxPerRun: maxPerRun.trim() ? Number(maxPerRun) : undefined,
    });
  };

  const running = statusQ.data?.running ?? false;
  const classifyStatus: ClassifyStatus | undefined = classifyQ.data;
  const classifying = classifyStatus?.running ?? false;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="-ml-1">
              <Link to="/" aria-label="返回论文列表">
                <ArrowLeft />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">研究方向 · 自动收录</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {cfgQ.data
                  ? `定时 ${cfgQ.data.schedule.cron} (${cfgQ.data.schedule.timezone}) · 单方向上限 ${cfgQ.data.maxPerRun} 篇`
                  : '加载中…'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              当前方向
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                aria-label="当前研究方向"
                className="h-9 max-w-64 rounded-md border border-input bg-background px-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value={GLOBAL_DIRECTION}>全局</option>
                {cfgQ.data?.directions.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="outline" disabled={running || checkMut.isPending} onClick={() => checkMut.mutate()}>
              {checkMut.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              立即检查
            </Button>
            <Button onClick={openCreate}>
              <Plus /> 新增方向
            </Button>
          </div>
        </header>

        {running && (
          <Card className="mt-5 flex items-center gap-2 p-4 text-sm">
            <Loader2 className="size-4 animate-spin" />
            自动检查进行中，正在抓取 arXiv 并解析论文…
          </Card>
        )}

        <section className="mt-6 space-y-3">
          {cfgQ.isLoading &&
            Array.from({ length: 2 }).map((_, i) => <Card key={i} className="h-24 animate-pulse p-4" />)}
          {!cfgQ.isLoading && (cfgQ.data?.directions.length ?? 0) === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有研究方向，点击右上角「新增方向」开始订阅
            </p>
          )}
          {cfgQ.data?.directions.map((d) => (
            <Card key={d.name} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{d.name}</span>
                    <Badge variant={d.enabled ? 'default' : 'outline'}>
                      {d.enabled ? '启用' : '停用'}
                    </Badge>
                    {d.maxPerRun !== undefined && (
                      <span className="text-xs text-muted-foreground">上限 {d.maxPerRun} 篇/次</span>
                    )}
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{d.query}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={toggleMut.isPending}
                    onClick={() => toggleMut.mutate(d)}
                  >
                    {d.enabled ? '停用' : '启用'}
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => openEdit(d)} aria-label="编辑">
                    <Pencil />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="删除"
                    onClick={() => {
                      if (window.confirm(`删除研究方向「${d.name}」？已收录的论文不会被删除。`)) {
                        deleteMut.mutate(d.name);
                      }
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </section>

        <section className="mt-8">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">已有论文分类</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  由 AI 根据标题和摘要判断每篇论文所属的研究方向，已分类的论文会跳过。
                </p>
                {classifying && classifyStatus && (
                  <p className="mt-1 text-sm">
                    进度 {classifyStatus.current}/{classifyStatus.total} · 命中{' '}
                    {classifyStatus.matched} · 失败 {classifyStatus.failed}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                disabled={classifying || classifyMut.isPending}
                onClick={() => classifyMut.mutate()}
              >
                {classifying || classifyMut.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Pencil />
                )}
                {classifying ? '分类中…' : '分类已有论文'}
              </Button>
            </div>
            {!classifying && (classifyStatus?.failed ?? 0) > 0 && (
              <ul className="mt-2 space-y-0.5 pl-4 text-xs text-destructive">
                {classifyStatus!.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">运行历史</h2>
          <div className="mt-3 space-y-3">
            {runsQ.isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}
            {!runsQ.isLoading && (runsQ.data?.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">还没有运行记录，点击「立即检查」开始第一次抓取。</p>
            )}
            {runsQ.data?.map((run) => (
              <Card key={run.runId} className="p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={run.status === 'running' ? 'outline' : 'secondary'}>
                    {run.status === 'running' ? '运行中' : '完成'}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{run.runId.slice(0, 8)}</span>
                  <span className="text-muted-foreground">{formatTime(run.startedAt)}</span>
                  <span className="text-muted-foreground">共 {run.directions.length} 个方向</span>
                </div>
                {run.directions.map((dir) => {
                  const counts = directionCounts(dir);
                  return (
                    <details key={dir.direction} className="mt-2">
                      <summary className="cursor-pointer text-sm">
                        {dir.direction}
                        <span className="ml-2 inline-flex flex-wrap gap-1">
                          {counts.added > 0 && <Badge variant="default">{counts.added} 新增</Badge>}
                          {counts.duplicate > 0 && <Badge variant="secondary">{counts.duplicate} 已存在</Badge>}
                          {counts.download_failed + counts.parse_failed > 0 && (
                            <Badge variant="destructive">
                              {counts.download_failed + counts.parse_failed} 失败
                            </Badge>
                          )}
                          {counts.previously_failed > 0 && (
                            <Badge variant="outline">{counts.previously_failed} 曾失败</Badge>
                          )}
                          {dir.error && <Badge variant="destructive">查询失败</Badge>}
                        </span>
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {dir.papers.map((p) => (
                          <li key={p.arxivId} className="flex flex-wrap items-center gap-x-2">
                            <Badge variant={STATUS_VARIANT[p.status]} className="text-[10px]">
                              {STATUS_LABEL[p.status]}
                            </Badge>
                            <span>{p.title}</span>
                            <span className="font-mono">{p.arxivId}</span>
                            {p.error && <span className="text-destructive">— {p.error}</span>}
                          </li>
                        ))}
                        {dir.error && <li className="text-destructive">方向查询失败: {dir.error}</li>}
                      </ul>
                    </details>
                  );
                })}
              </Card>
            ))}
          </div>
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑研究方向' : '新增研究方向'}</DialogTitle>
            <DialogDescription>
              使用 arXiv API 查询语法，如 abs:"diffusion model" AND abs:adversarial AND abs:attack
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="direction-name">名称</Label>
              <Input
                id="direction-name"
                value={name}
                disabled={!!editing}
                placeholder="如：基于扩散模型的对抗攻击"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="direction-query">arXiv 查询词</Label>
              <Textarea
                id="direction-query"
                value={query}
                placeholder='abs:"diffusion model" AND abs:adversarial AND abs:attack'
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="direction-max">单次最多收录（留空用全局默认）</Label>
              <Input
                id="direction-max"
                type="number"
                min={1}
                value={maxPerRun}
                placeholder="5"
                onChange={(e) => setMaxPerRun(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="size-4"
              />
              启用该方向
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button disabled={saveMut.isPending} onClick={submit}>
              {saveMut.isPending && <Loader2 className="animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
