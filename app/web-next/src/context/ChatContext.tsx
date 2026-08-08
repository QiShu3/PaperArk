import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import type { ChatMessage, ChatSession, ToolCall, ToolCallDelta } from '@/types';
import { api } from '@/api';

interface Session {
  messages: ChatMessage[];
  cacheRate: number | null;
  loaded: boolean;
  loadError?: string;
  persistError?: string;
}

interface ChatContextValue {
  sessions: Record<string, Session>;
  activeSessionId: Record<string, string>;
  sessionList: Record<string, ChatSession[]>;
  getMessages: (paperId: string) => ChatMessage[];
  getCacheRate: (paperId: string) => number | null;
  isLoaded: (paperId: string) => boolean;
  loadHistory: (paperId: string) => Promise<void>;
  loadSessions: (paperId: string) => Promise<string | null>;
  switchSession: (paperId: string, sessionId: string) => Promise<void>;
  createNewSession: (paperId: string) => Promise<string>;
  deleteCurrentSession: (paperId: string) => Promise<void>;
  renameSession: (paperId: string, sessionId: string, title: string) => Promise<void>;
  appendMessage: (paperId: string, msg: ChatMessage) => void;
  updateLastAssistant: (paperId: string, content: string) => void;
  updateLastAssistantToolCalls: (paperId: string, deltas: ToolCallDelta[]) => void;
  persistSession: (paperId: string) => Promise<void>;
  setCacheRate: (paperId: string, rate: number | null) => void;
  clearSession: (paperId: string) => Promise<void>;
  rollbackLastRound: (paperId: string) => Promise<void>;
  getLoadError: (paperId: string) => string | undefined;
  getPersistError: (paperId: string) => string | undefined;
  clearError: (paperId: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function sessionKey(paperId: string, activeMap: Record<string, string>) {
  return activeMap[paperId] ?? '';
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [activeSessionId, setActiveSessionId] = useState<Record<string, string>>({});
  const [sessionList, setSessionList] = useState<Record<string, ChatSession[]>>({});
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const activeRef = useRef(activeSessionId);
  activeRef.current = activeSessionId;

  const getMessages = useCallback(
    (paperId: string) => {
      const sid = sessionKey(paperId, activeSessionId);
      return sid ? (sessions[sid]?.messages ?? []) : [];
    },
    [sessions, activeSessionId],
  );

  const getCacheRate = useCallback(
    (paperId: string) => {
      const sid = sessionKey(paperId, activeSessionId);
      return sid ? (sessions[sid]?.cacheRate ?? null) : null;
    },
    [sessions, activeSessionId],
  );

  const isLoaded = useCallback(
    (paperId: string) => {
      const sid = sessionKey(paperId, activeSessionId);
      return sid ? (sessions[sid]?.loaded ?? false) : false;
    },
    [sessions, activeSessionId],
  );

  const loadHistory = useCallback(async (paperId: string) => {
    const sid = activeRef.current[paperId];
    if (!sid) return;
    try {
      const rows = await api.loadChat(paperId, sid);
      const messages: ChatMessage[] = rows
        .filter((r) => r.role === 'user' || r.role === 'assistant' || r.role === 'tool')
        .map((r) => ({
          role: r.role as ChatMessage['role'],
          content: r.content,
          tool_calls: r.tool_calls ? (JSON.parse(r.tool_calls) as ToolCall[]) : undefined,
          tool_call_id: r.tool_call_id ?? undefined,
          name: r.name ?? undefined,
        }));
      setSessions((prev) => ({
        ...prev,
        [sid]: { messages, cacheRate: prev[sid]?.cacheRate ?? null, loaded: true },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '加载失败';
      setSessions((prev) => ({
        ...prev,
        [sid]: { messages: [], cacheRate: null, loaded: true, loadError: msg },
      }));
    }
  }, []);

  const loadSessions = useCallback(async (paperId: string): Promise<string | null> => {
    try {
      const list = await api.listSessions(paperId);
      setSessionList((prev) => ({ ...prev, [paperId]: list }));

      const currentActive = activeRef.current[paperId];
      if (currentActive && list.some((s) => s.id === currentActive)) {
        return currentActive;
      }

      const latest = list[0];
      if (latest) {
        setActiveSessionId((prev) => ({ ...prev, [paperId]: latest.id }));
        return latest.id;
      }

      return null;
    } catch {
      return null;
    }
  }, []);

  const switchSession = useCallback(async (paperId: string, sessionId: string) => {
    setActiveSessionId((prev) => ({ ...prev, [paperId]: sessionId }));
    try {
      const rows = await api.loadChat(paperId, sessionId);
      const messages: ChatMessage[] = rows
        .filter((r) => r.role === 'user' || r.role === 'assistant' || r.role === 'tool')
        .map((r) => ({
          role: r.role as ChatMessage['role'],
          content: r.content,
          tool_calls: r.tool_calls ? (JSON.parse(r.tool_calls) as ToolCall[]) : undefined,
          tool_call_id: r.tool_call_id ?? undefined,
          name: r.name ?? undefined,
        }));
      setSessions((prev) => ({
        ...prev,
        [sessionId]: { messages, cacheRate: null, loaded: true },
      }));
    } catch {
      setSessions((prev) => ({
        ...prev,
        [sessionId]: { messages: [], cacheRate: null, loaded: true },
      }));
    }
  }, []);

  const createNewSession = useCallback(async (paperId: string): Promise<string> => {
    const session = await api.createSession(paperId);
    setSessionList((prev) => ({
      ...prev,
      [paperId]: [session, ...(prev[paperId] ?? [])],
    }));
    setActiveSessionId((prev) => ({ ...prev, [paperId]: session.id }));
    setSessions((prev) => ({
      ...prev,
      [session.id]: { messages: [], cacheRate: null, loaded: false },
    }));
    return session.id;
  }, []);

  const deleteCurrentSession = useCallback(async (paperId: string) => {
    const sid = activeRef.current[paperId];
    if (!sid) return;
    const list = sessionList[paperId] ?? [];
    try {
      await api.deleteSession(paperId, sid);
    } catch {
      // continue with local cleanup
    }

    const remaining = list.filter((s) => s.id !== sid);
    setSessionList((prev) => ({ ...prev, [paperId]: remaining }));

    setSessions((prev) => {
      const next = { ...prev };
      delete next[sid];
      return next;
    });

    const nextSid = remaining[0]?.id;
    if (nextSid) {
      setActiveSessionId((prev) => ({ ...prev, [paperId]: nextSid }));
      try {
        const rows = await api.loadChat(paperId, nextSid);
        const messages: ChatMessage[] = rows
          .filter((r) => r.role === 'user' || r.role === 'assistant' || r.role === 'tool')
          .map((r) => ({
            role: r.role as ChatMessage['role'],
            content: r.content,
            tool_calls: r.tool_calls ? (JSON.parse(r.tool_calls) as ToolCall[]) : undefined,
            tool_call_id: r.tool_call_id ?? undefined,
            name: r.name ?? undefined,
          }));
        setSessions((prev2) => ({
          ...prev2,
          [nextSid]: { messages, cacheRate: null, loaded: true },
        }));
      } catch {
        setSessions((prev2) => ({
          ...prev2,
          [nextSid]: { messages: [], cacheRate: null, loaded: true },
        }));
      }
    } else {
      setActiveSessionId((prev) => {
        const next = { ...prev };
        delete next[paperId];
        return next;
      });
    }
  }, [sessionList]);

  const renameSession = useCallback(async (paperId: string, sessionId: string, title: string) => {
    setSessionList((prev) => {
      const list = [...(prev[paperId] ?? [])];
      const idx = list.findIndex((s) => s.id === sessionId);
      if (idx === -1) return prev;
      list[idx] = { ...list[idx], title };
      return { ...prev, [paperId]: list };
    });
    try {
      await api.updateSessionTitle(paperId, sessionId, title);
    } catch (e) {
      console.warn('renameSession: save failed', e);
    }
  }, []);

  const appendMessage = useCallback((paperId: string, msg: ChatMessage) => {
    const sid = activeRef.current[paperId];
    if (!sid) return;
    setSessions((prev) => {
      const cur = prev[sid] ?? { messages: [], cacheRate: null, loaded: true };
      return { ...prev, [sid]: { ...cur, messages: [...cur.messages, msg] } };
    });
  }, []);

  const updateLastAssistant = useCallback((paperId: string, content: string) => {
    const sid = activeRef.current[paperId];
    if (!sid) return;
    setSessions((prev) => {
      const cur = prev[sid];
      if (!cur || cur.messages.length === 0) return prev;
      const msgs = [...cur.messages];
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content };
      return { ...prev, [sid]: { ...cur, messages: msgs } };
    });
  }, []);

  const updateLastAssistantToolCalls = useCallback(
    (paperId: string, deltas: ToolCallDelta[]) => {
      const sid = activeRef.current[paperId];
      if (!sid) return;
      setSessions((prev) => {
        const cur = prev[sid];
        if (!cur || cur.messages.length === 0) return prev;
        const msgs = [...cur.messages];
        const last = { ...msgs[msgs.length - 1] };
        const existing = [...(last.tool_calls ?? [])];

        for (const delta of deltas) {
          const slot = delta.index;
          const prevCall = existing[slot] ?? {
            id: '',
            type: 'function' as const,
            function: { name: '', arguments: '' },
          };
          existing[slot] = {
            id: delta.id ?? prevCall.id,
            type: delta.type ?? prevCall.type,
            function: {
              name: delta.function?.name ?? prevCall.function.name,
              arguments: prevCall.function.arguments + (delta.function?.arguments ?? ''),
            },
          };
        }

        last.tool_calls = existing.filter(Boolean);
        msgs[msgs.length - 1] = last;
        return { ...prev, [sid]: { ...cur, messages: msgs } };
      });
    },
    [],
  );

  const persistSession = useCallback(async (paperId: string) => {
    const sid = activeRef.current[paperId];
    if (!sid) return;
    const msgs = sessionsRef.current[sid]?.messages;
    if (!msgs || msgs.length === 0) return;
    try {
      await api.saveChat(
        paperId,
        sid,
        msgs.map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls as Record<string, unknown>[] | undefined,
          tool_call_id: m.tool_call_id,
          name: m.name,
        })),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存失败';
      setSessions((prev) => {
        const cur = prev[sid];
        if (!cur) return prev;
        return { ...prev, [sid]: { ...cur, persistError: msg } };
      });
    }
  }, []);

  const setCacheRateFn = useCallback((paperId: string, rate: number | null) => {
    const sid = activeRef.current[paperId];
    if (!sid) return;
    setSessions((prev) => {
      const cur = prev[sid] ?? { messages: [], cacheRate: null, loaded: true };
      return { ...prev, [sid]: { ...cur, cacheRate: rate } };
    });
  }, []);

  const rollbackLastRound = useCallback(async (paperId: string) => {
    const sid = activeRef.current[paperId];
    if (!sid) return;

    const msgs = sessionsRef.current[sid]?.messages;
    if (!msgs || msgs.length <= 1) return;

    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;

    const truncated = msgs.slice(0, lastUserIdx);

    setSessions((prev) => {
      const cur = prev[sid];
      if (!cur) return prev;
      return { ...prev, [sid]: { ...cur, messages: truncated, persistError: undefined } };
    });

    try {
      await api.saveChat(
        paperId,
        sid,
        truncated.map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls as Record<string, unknown>[] | undefined,
          tool_call_id: m.tool_call_id,
          name: m.name,
        })),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存失败';
      setSessions((prev) => {
        const cur = prev[sid];
        if (!cur) return prev;
        return { ...prev, [sid]: { ...cur, persistError: msg } };
      });
    }
  }, []);

  const clearSession = useCallback(async (paperId: string) => {
    const sid = activeRef.current[paperId];
    if (!sid) return;
    setSessions((prev) => {
      const next = { ...prev };
      delete next[sid];
      return next;
    });
    try {
      await api.clearChat(paperId, sid);
    } catch (e) {
      console.warn('clearSession: server clear failed', e);
    }
  }, []);

  const getLoadError = useCallback(
    (paperId: string) => {
      const sid = activeSessionId[paperId];
      return sid ? sessions[sid]?.loadError : undefined;
    },
    [sessions, activeSessionId],
  );

  const getPersistError = useCallback(
    (paperId: string) => {
      const sid = activeSessionId[paperId];
      return sid ? sessions[sid]?.persistError : undefined;
    },
    [sessions, activeSessionId],
  );

  const clearError = useCallback((paperId: string) => {
    const sid = activeRef.current[paperId];
    if (!sid) return;
    setSessions((prev) => {
      const cur = prev[sid];
      if (!cur || (!cur.loadError && !cur.persistError)) return prev;
      return { ...prev, [sid]: { ...cur, loadError: undefined, persistError: undefined } };
    });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        sessions,
        activeSessionId,
        sessionList,
        getMessages,
        getCacheRate,
        isLoaded,
        loadHistory,
        loadSessions,
        switchSession,
        createNewSession,
        deleteCurrentSession,
        renameSession,
        appendMessage,
        updateLastAssistant,
        updateLastAssistantToolCalls,
        persistSession,
        setCacheRate: setCacheRateFn,
        clearSession,
        rollbackLastRound,
        getLoadError,
        getPersistError,
        clearError,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}
