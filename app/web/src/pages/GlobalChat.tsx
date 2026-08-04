import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useChatContext } from '@/context/ChatContext';
import { api } from '@/api';
import type { ChatSession } from '@/types';
import ChatPanel from '@/components/ChatPanel';
import SessionSidebar from '@/components/SessionSidebar';
import ToolSidebar from '@/components/ToolSidebar';
import SettingsDialog, { getSettings, loadSettings, saveSettings } from '@/components/SettingsDialog';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';

const GLOBAL_PAPER_ID = '__global__';

export default function GlobalChat() {
  const navigate = useNavigate();
  const {
    loadSessions,
    createNewSession,
    deleteCurrentSession,
    switchSession,
    renameSession,
    activeSessionId,
    sessionList,
  } = useChatContext();

  const [settings, setSettings] = useState(getSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [inputText, setInputText] = useState('');

  const sessionId = activeSessionId[GLOBAL_PAPER_ID] ?? '';
  const sessions = sessionList[GLOBAL_PAPER_ID] ?? [];

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  useEffect(() => {
    loadSessions(GLOBAL_PAPER_ID).then((sid) => {
      if (!sid) {
        createNewSession(GLOBAL_PAPER_ID);
      }
    });
  }, [loadSessions, createNewSession]);

  const handleSettingsChange = useCallback((next: typeof settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleNewSession = useCallback(async () => {
    await createNewSession(GLOBAL_PAPER_ID);
  }, [createNewSession]);

  const handleDeleteSession = useCallback(async (sid: string) => {
    await deleteCurrentSession(GLOBAL_PAPER_ID);
  }, [deleteCurrentSession]);

  const handleSessionSelect = useCallback(async (sid: string) => {
    await switchSession(GLOBAL_PAPER_ID, sid);
  }, [switchSession]);

  const handleRenameSession = useCallback((sid: string, title: string) => {
    renameSession(GLOBAL_PAPER_ID, sid, title);
  }, [renameSession]);

  const handleInsertReference = useCallback((text: string) => {
    setInputText((prev) => prev + (prev ? '\n' : '') + text);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="返回">
            <ArrowLeft />
          </Button>
          <h1 className="text-lg font-semibold">全局对话</h1>
          <Sparkles className="size-4 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {sessions.length} 个会话
          </span>
        </div>
      </header>

      {/* Main 3-column layout */}
      <div className="flex min-h-0 flex-1">
        {/* Left: Session Sidebar */}
        <SessionSidebar
          collapsed={leftCollapsed}
          onToggle={() => setLeftCollapsed(!leftCollapsed)}
          sessions={sessions}
          activeSessionId={sessionId}
          onSessionSelect={handleSessionSelect}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Center: Chat Panel */}
        <div className="min-w-0 flex-1">
          <ErrorBoundary>
            <ChatPanel
              mode="global"
              apiKey={settings.apiKey}
              model={settings.model}
              onModelChange={(m) => handleSettingsChange({ ...settings, model: m })}
              quoteTexts={[]}
              onQuoteRemove={() => {}}
              onQuotesClear={() => {}}
              inputValue={inputText}
              onInputChange={setInputText}
            />
          </ErrorBoundary>
        </div>

        {/* Right: Tool Sidebar */}
        <ToolSidebar
          collapsed={rightCollapsed}
          onToggle={() => setRightCollapsed(!rightCollapsed)}
          onInsertReference={handleInsertReference}
        />
      </div>

      {/* Settings Dialog */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
    </div>
  );
}
