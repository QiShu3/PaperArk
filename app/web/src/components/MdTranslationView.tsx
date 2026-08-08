import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Languages, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../api';
import type { MdTranslationRecord } from '../types';
import MarkdownView from './MarkdownView';
import { Button } from './ui/button';

interface Props {
  paperId: string;
  markdown: string;
  onTextSelect?: (text: string) => void;
}

export default function MdTranslationView({ paperId, markdown, onTextSelect }: Props) {
  const [mode, setMode] = useState<'orig' | 'zh'>('orig');
  const [record, setRecord] = useState<MdTranslationRecord | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRecord(await api.getMdTranslateStatus(paperId));
    } catch {
      // 轮询失败时静默等待下一次
    }
  }, [paperId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = record?.status === 'running';

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const start = async () => {
    setStarting(true);
    try {
      setRecord(await api.startMdTranslate(paperId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '启动翻译失败');
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      setRecord(await api.cancelMdTranslate(paperId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  const tabClass = (active: boolean) =>
    `px-2.5 py-1 transition-colors ${
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
    }`;

  const zhDone = mode === 'zh' && record?.status === 'done';
  const failed = record?.status === 'failed' || record?.status === 'cancelled';

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex rounded-md border text-xs">
          <button className={tabClass(mode === 'orig')} onClick={() => setMode('orig')}>
            原文
          </button>
          <button className={`${tabClass(mode === 'zh')} border-l`} onClick={() => setMode('zh')}>
            中文
          </button>
        </div>

        {mode === 'zh' && record?.status === 'idle' && (
          <Button variant="outline" size="sm" onClick={start} disabled={starting}>
            {starting ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
            翻译为中文
          </Button>
        )}

        {mode === 'zh' && running && (
          <span className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs">
            <Loader2 className="size-3.5 animate-spin text-primary" />
            <span className="text-muted-foreground">
              翻译中 {record.progress?.done ?? 0}/{record.progress?.total ?? '-'}
            </span>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={cancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="size-3 animate-spin" /> : null} 取消
            </Button>
          </span>
        )}

        {mode === 'zh' && failed && (
          <span className="inline-flex items-center gap-2 rounded-md bg-destructive/10 px-2.5 py-1 text-xs text-destructive">
            <XCircle className="size-3.5" />
            {record?.status === 'cancelled' ? '翻译已取消' : record?.error || '翻译失败'}
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={start} disabled={starting}>
              {starting ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              重试
            </Button>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <MarkdownView
          content={zhDone ? (record?.content ?? '') : markdown}
          onTextSelect={onTextSelect}
        />
      </div>
    </div>
  );
}
