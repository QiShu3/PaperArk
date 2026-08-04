import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Building2,
  Calendar,
  ExternalLink,
  FileText,
  FlaskConical,
  Loader2,
  Pencil,
  Save,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import { useChatContext } from '../context/ChatContext';
import MarkdownView from '../components/MarkdownView';
import MdEditor from '../components/MdEditor';
import PdfViewer from '../components/PdfViewer';
import ChunkView from '../components/ChunkView';
import TagEditor from '../components/TagEditor';
import ChatPanel from '../components/ChatPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';
import SettingsDialog, { getSettings, loadSettings, saveSettings } from '../components/SettingsDialog';
import type { Settings as SettingsType } from '../types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../components/ui/alert-dialog';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';

export default function PaperReader() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { loadSessions, createNewSession } = useChatContext();

  const paperQ = useQuery({ queryKey: ['paper', id], queryFn: () => api.getPaper(id) });
  const paper = paperQ.data;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [contentTab, setContentTab] = useState<'md' | 'pdf' | 'chunk'>('md');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsType>(getSettings);
  const [quoteTexts, setQuoteTexts] = useState<string[]>([]);
  const [chunkContent, setChunkContent] = useState('');
  const [chunkHeading, setChunkHeading] = useState('');
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDraft, setMetaDraft] = useState<{ venue?: string; year?: string; area?: string }>({});

  const startEditMeta = () => {
    setMetaDraft({ venue: paper?.venue, year: paper?.year, area: paper?.area });
    setEditingMeta(true);
  };

  const saveMeta = async () => {
    if (!paper) return;
    try {
      await api.updatePaper(id, metaDraft);
      invalidate();
      setEditingMeta(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const cancelEditMeta = () => {
    setEditingMeta(false);
  };

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    loadSessions(id).then((sid) => {
      if (!sid) createNewSession(id);
    });
  }, [id, loadSessions, createNewSession]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['paper', id] });
    qc.invalidateQueries({ queryKey: ['papers'] });
    qc.invalidateQueries({ queryKey: ['tags'] });
  };

  const startEdit = () => {
    setDraft(paper?.markdown ?? '');
    setEditing(true);
  };

  const saveMut = useMutation({
    mutationFn: () => api.updatePaper(id, { markdown: draft }),
    onSuccess: () => {
      toast.success('已保存');
      setEditing(false);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '保存失败'),
  });

  const saveTags = (next: string[]) => {
    api
      .updatePaper(id, { tags: next })
      .then(() => invalidate())
      .catch((e) => toast.error(e instanceof Error ? e.message : '标签保存失败'));
  };

  const deleteMut = useMutation({
    mutationFn: () => api.deletePaper(id),
    onSuccess: () => {
      toast.success('已删除');
      qc.invalidateQueries({ queryKey: ['papers'] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      navigate('/');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '删除失败'),
  });

  const handleSettingsChange = (s: SettingsType) => {
    setSettings(s);
    saveSettings(s);
  };

  if (paperQ.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="mt-6 h-[70vh] w-full" />
      </div>
    );
  }

  if (paperQ.error || !paper) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <p className="text-sm text-destructive">
          {paperQ.error instanceof Error ? paperQ.error.message : '论文不存在'}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>
          <ArrowLeft /> 返回列表
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="返回">
                <ArrowLeft />
              </Button>
              <h1 className="truncate text-lg font-semibold">{paper.title}</h1>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-xs text-muted-foreground">
              <span className="font-mono">{paper.id}</span>
              <a
                href={`https://arxiv.org/abs/${paper.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <ExternalLink className="size-3.5" /> arXiv
              </a>
              {paper.hasPdf && (
                <a
                  href={`/rawPDF/${paper.id}.pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <FileText className="size-3.5" /> 新窗口打开 PDF
                </a>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)} title="设置">
              <Settings className="size-4" />
            </Button>
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                  <X /> 取消
                </Button>
                <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                  {saveMut.isPending ? <Loader2 className="animate-spin" /> : <Save />} 保存
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={startEdit}>
                  <Pencil /> 编辑
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive">
                      <Trash2 /> 删除
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>删除这篇论文?</AlertDialogTitle>
                      <AlertDialogDescription>
                        将同时删除对应的 PDF、Markdown 以及不再被引用的图片。此操作不可撤销。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMut.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {deleteMut.isPending ? <Loader2 className="animate-spin" /> : null} 确认删除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            </div>

            {(paper.venue || paper.year || paper.area) && !editingMeta && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-11">
                {paper.venue && (
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    <Building2 className="size-3" />
                    {paper.venue}
                  </span>
                )}
                {paper.year && (
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    <Calendar className="size-3" />
                    {paper.year}
                  </span>
                )}
                {paper.area && (
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    <FlaskConical className="size-3" />
                    {paper.area}
                  </span>
                )}
                <button
                  onClick={startEditMeta}
                  className="ml-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="编辑发表信息"
                >
                  <Pencil className="size-3" />
                </button>
              </div>
            )}

            {editingMeta && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-11">
                <input
                  type="text"
                  value={metaDraft.venue ?? ''}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, venue: e.target.value }))}
                  placeholder="会议/期刊"
                  className="h-7 w-36 rounded border bg-background px-2 text-xs"
                />
                <input
                  type="text"
                  value={metaDraft.year ?? ''}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, year: e.target.value }))}
                  placeholder="年份"
                  className="h-7 w-20 rounded border bg-background px-2 text-xs"
                />
                <input
                  type="text"
                  value={metaDraft.area ?? ''}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, area: e.target.value }))}
                  placeholder="研究方向"
                  className="h-7 w-28 rounded border bg-background px-2 text-xs"
                />
                <button
                  onClick={saveMeta}
                  className="rounded p-1 text-xs text-green-600 hover:bg-accent"
                  title="保存"
                >
                  <Save className="size-3.5" />
                </button>
                <button
                  onClick={cancelEditMeta}
                  className="rounded p-1 text-xs text-muted-foreground hover:bg-accent"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {(paper.venue || paper.year || paper.area) ? null : !editingMeta && (
              <div className="mt-1.5 pl-11">
                <button
                  onClick={startEditMeta}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="添加发表信息"
                >
                  <Pencil className="size-3" /> 添加发表信息
                </button>
              </div>
            )}
          </div>

        <div className="mt-3 flex items-center gap-3 pl-11">
          <TagEditor tags={paper.tags} onChange={saveTags} />
          {paper.hasMd && !editing && (
            <div className="ml-auto flex rounded-md border text-xs">
              <button
                className={`px-2.5 py-1 transition-colors ${
                  contentTab === 'md' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setContentTab('md')}
              >
                Markdown
              </button>
              {paper.hasPdf && (
                <button
                  className={`px-2.5 py-1 transition-colors border-l ${
                    contentTab === 'pdf' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setContentTab('pdf')}
                >
                  PDF
                </button>
              )}
              <button
                className={`px-2.5 py-1 transition-colors border-l ${
                  contentTab === 'chunk' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setContentTab('chunk')}
              >
                分块
              </button>
            </div>
          )}
        </div>
      </header>

      <Separator />

      <main className="min-h-0 flex-1">
        {editing ? (
          <div className="h-full p-3">
            <MdEditor value={draft} onChange={setDraft} />
          </div>
        ) : (
          <div className="grid h-full grid-cols-1 lg:grid-cols-2">
            {/* Left: MD or PDF */}
            <div className="h-full min-h-0 overflow-auto border-r p-5">
              {contentTab === 'chunk' ? (
                <ChunkView
                  paperId={paper.id}
                  onActiveChunkChange={(heading, content) => {
                    setChunkHeading(heading);
                    setChunkContent(content);
                  }}
                />
              ) : contentTab === 'md' ? (
                <MarkdownView
                  content={paper.markdown}
                  onTextSelect={(text) => setQuoteTexts((prev) => [...prev, text])}
                />
              ) : paper.hasPdf ? (
                <PdfViewer url={`/rawPDF/${paper.id}.pdf`} title={paper.title} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  无 PDF 文件
                </div>
              )}
            </div>

            {/* Right: AI Chat */}
            <div className="h-full min-h-0">
              <ErrorBoundary>
                <ChatPanel
                  paperId={paper.id}
                  paperTitle={paper.title}
                  paperContent={contentTab === 'chunk' ? chunkContent : paper.markdown}
                  apiKey={settings.apiKey}
                  model={settings.model}
                  onModelChange={(m) => handleSettingsChange({ ...settings, model: m })}
                  quoteTexts={quoteTexts}
                  onQuoteRemove={(i) => setQuoteTexts((prev) => prev.filter((_, j) => j !== i))}
                  onQuotesClear={() => setQuoteTexts([])}
                  contentMode={contentTab === 'chunk' ? 'chunk' : 'full'}
                  chunkHeading={chunkHeading}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  );
}
