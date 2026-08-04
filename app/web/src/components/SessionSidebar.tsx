import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Settings, Trash2, MessageSquare, Pencil } from 'lucide-react';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import type { ChatSession } from '@/types';

interface SessionSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onOpenSettings: () => void;
  isStreaming?: boolean;
}

export default function SessionSidebar({
  collapsed,
  onToggle,
  sessions,
  activeSessionId,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onOpenSettings,
  isStreaming = false,
}: SessionSidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) renameInputRef.current?.select();
  }, [editingId]);

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (deletingId) return;
    setDeletingId(sessionId);
    try {
      await onDeleteSession(sessionId);
    } finally {
      setDeletingId(null);
    }
  };

  const startRename = (e: React.MouseEvent, sessionId: string, title: string) => {
    e.stopPropagation();
    setEditingId(sessionId);
    setDraftTitle(title);
  };

  const confirmRename = (sessionId: string) => {
    setEditingId(null);
    const trimmed = draftTitle.trim();
    const prev = sessions.find((s) => s.id === sessionId)?.title ?? '';
    if (trimmed && trimmed !== prev) {
      onRenameSession(sessionId, trimmed);
    }
  };

  const cancelRename = () => {
    setEditingId(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, sessionId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmRename(sessionId);
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  };

  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-r bg-muted/30 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          title="展开会话列表"
          className="mb-2"
        >
          <ChevronRight className="size-3.5" />
        </Button>
        <Separator className="my-2" />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onNewSession}
          disabled={isStreaming}
          title="新建会话"
          className="mb-1"
        >
          <Plus className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onOpenSettings}
          title="设置"
        >
          <Settings className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-56 flex-col border-r bg-muted/30">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">会话列表</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          title="收起会话列表"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
      </div>

      {/* Session List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-8 text-xs text-muted-foreground">
            <MessageSquare className="mb-2 size-6 opacity-40" />
            <p>暂无会话</p>
          </div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`group mb-1 flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
                session.id === activeSessionId
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
              onClick={() => !isStreaming && onSessionSelect(session.id)}
            >
              <div className="min-w-0 flex-1">
                {editingId === session.id ? (
                  <input
                    ref={renameInputRef}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => confirmRename(session.id)}
                    onKeyDown={(e) => handleRenameKeyDown(e, session.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded border bg-background px-1 py-0 text-xs outline-none ring-1 ring-ring"
                  />
                ) : (
                  <p className="truncate text-xs font-medium">{session.title}</p>
                )}
                <p className="truncate text-[10px] opacity-60">
                  {new Date(session.updated_at).toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  className="rounded p-0.5 hover:bg-accent hover:text-foreground"
                  onClick={(e) => startRename(e, session.id, session.title)}
                  disabled={isStreaming}
                  title="重命名"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  className="rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
                  onClick={(e) => handleDelete(e, session.id)}
                  disabled={deletingId === session.id || isStreaming}
                  title="删除会话"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer Actions */}
      <div className="shrink-0 border-t p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-1.5 text-xs"
          onClick={onNewSession}
          disabled={isStreaming}
        >
          <Plus className="size-3.5" /> 新建会话
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start gap-1.5 text-xs text-muted-foreground"
          onClick={onOpenSettings}
        >
          <Settings className="size-3.5" /> 设置
        </Button>
      </div>
    </div>
  );
}
