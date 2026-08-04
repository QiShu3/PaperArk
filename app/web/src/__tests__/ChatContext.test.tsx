import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ChatProvider, useChatContext } from '../context/ChatContext';
import type { ChatMessage, ToolCall } from '../types';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listSessions: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    loadChat: vi.fn(),
    saveChat: vi.fn(),
    clearChat: vi.fn(),
  },
}));

vi.mock('@/api', () => ({
  api: mockApi,
}));

async function setupSession(result: { current: ReturnType<typeof useChatContext> }, paperId = 'test-paper') {
  mockApi.listSessions.mockResolvedValueOnce([
    { id: 'session-1', paper_id: paperId, title: 'Default Session', created_at: '', updated_at: '' },
  ]);
  await act(async () => {
    await result.current.loadSessions(paperId);
  });
}

describe('ChatContext', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ChatProvider>{children}</ChatProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appendMessage adds a user message', async () => {
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await setupSession(result);

    act(() => {
      result.current.appendMessage('test-paper', { role: 'user', content: 'hello' });
    });

    const msgs = result.current.getMessages('test-paper');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('hello');
  });

  it('updateLastAssistant replaces last assistant content', async () => {
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await setupSession(result);

    act(() => {
      result.current.appendMessage('test-paper', { role: 'user', content: 'q' });
      result.current.appendMessage('test-paper', { role: 'assistant', content: '' });
    });

    act(() => {
      result.current.updateLastAssistant('test-paper', 'streaming...');
    });

    act(() => {
      result.current.updateLastAssistant('test-paper', 'final answer');
    });

    const msgs = result.current.getMessages('test-paper');
    expect(msgs[1].content).toBe('final answer');
  });

  it('updateLastAssistantToolCalls merges tool_calls deltas by index', async () => {
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await setupSession(result);

    act(() => {
      result.current.appendMessage('test-paper', { role: 'user', content: 'search' });
      result.current.appendMessage('test-paper', { role: 'assistant', content: null });
    });

    act(() => {
      result.current.updateLastAssistantToolCalls('test-paper', [
        { index: 0, id: 'call_1', type: 'function', function: { name: 'search_chunks', arguments: '{"query"' } },
      ]);
    });

    act(() => {
      result.current.updateLastAssistantToolCalls('test-paper', [
        { index: 0, function: { arguments: ':"attention"}' } },
      ]);
    });

    const msgs = result.current.getMessages('test-paper');
    const assistant = msgs[1] as ChatMessage;
    expect(assistant.tool_calls).toBeDefined();
    expect(assistant.tool_calls![0].id).toBe('call_1');
    expect(assistant.tool_calls![0].function.name).toBe('search_chunks');
    expect(assistant.tool_calls![0].function.arguments).toBe('{"query":"attention"}');
  });

  it('loadHistory parses tool_calls JSON from DB', async () => {
    mockApi.loadChat.mockResolvedValueOnce([
      { id: 1, role: 'user', content: 'hello', tool_calls: null, tool_call_id: null, name: null },
      { id: 2, role: 'assistant', content: null, tool_calls: '[{"id":"c1","type":"function","function":{"name":"search_chunks","arguments":"{}"}}]', tool_call_id: null, name: null },
      { id: 3, role: 'tool', content: 'result', tool_calls: null, tool_call_id: 'c1', name: 'search_chunks' },
    ]);

    const { result } = renderHook(() => useChatContext(), { wrapper });
    await setupSession(result);

    await act(async () => {
      await result.current.loadHistory('test-paper');
    });

    const msgs = result.current.getMessages('test-paper');
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].tool_calls).toBeDefined();
    expect(msgs[1].tool_calls![0].function.name).toBe('search_chunks');
    expect(msgs[2].role).toBe('tool');
    expect(msgs[2].tool_call_id).toBe('c1');
  });

  it('persistSession saves messages with sessionId', async () => {
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await setupSession(result);

    const tc: ToolCall = { id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } };

    act(() => {
      result.current.appendMessage('test-paper', { role: 'user', content: 'q' });
      result.current.appendMessage('test-paper', { role: 'assistant', content: null, tool_calls: [tc] });
    });

    await act(async () => {
      await result.current.persistSession('test-paper');
    });

    expect(mockApi.saveChat).toHaveBeenCalledWith('test-paper', 'session-1', [
      { role: 'user', content: 'q', tool_calls: undefined, tool_call_id: undefined, name: undefined },
      { role: 'assistant', content: null, tool_calls: [tc], tool_call_id: undefined, name: undefined },
    ]);
  });

  it('clearSession deletes local state and calls clearChat with sessionId', async () => {
    const { result } = renderHook(() => useChatContext(), { wrapper });
    await setupSession(result);

    act(() => {
      result.current.appendMessage('test-paper', { role: 'user', content: 'q' });
    });

    await act(async () => {
      await result.current.clearSession('test-paper');
    });

    expect(result.current.getMessages('test-paper')).toHaveLength(0);
    expect(mockApi.clearChat).toHaveBeenCalledWith('test-paper', 'session-1');
  });

  it('createNewSession creates session and switches to it', async () => {
    mockApi.createSession.mockResolvedValueOnce({
      id: 'session-2',
      paper_id: 'test-paper',
      title: '新对话',
      created_at: '',
      updated_at: '',
    });

    const { result } = renderHook(() => useChatContext(), { wrapper });

    await act(async () => {
      const sid = await result.current.createNewSession('test-paper');
      expect(sid).toBe('session-2');
    });

    expect(mockApi.createSession).toHaveBeenCalledWith('test-paper');
    expect(result.current.activeSessionId['test-paper']).toBe('session-2');
  });

  it('switchSession loads messages for different session', async () => {
    mockApi.loadChat.mockResolvedValueOnce([
      { id: 1, role: 'user', content: 'from other session', tool_calls: null, tool_call_id: null, name: null },
    ]);

    const { result } = renderHook(() => useChatContext(), { wrapper });

    await act(async () => {
      await result.current.switchSession('test-paper', 'session-other');
    });

    expect(mockApi.loadChat).toHaveBeenCalledWith('test-paper', 'session-other');
    expect(result.current.activeSessionId['test-paper']).toBe('session-other');
    expect(result.current.getMessages('test-paper')).toHaveLength(1);
  });

  it('deleteCurrentSession removes session and switches to remaining', async () => {
    mockApi.listSessions.mockResolvedValueOnce([
      { id: 'session-1', paper_id: 'test-paper', title: 'First', created_at: '', updated_at: '' },
      { id: 'session-2', paper_id: 'test-paper', title: 'Second', created_at: '', updated_at: '' },
    ]);

    mockApi.loadChat.mockResolvedValueOnce([
      { id: 1, role: 'user', content: 'from second', tool_calls: null, tool_call_id: null, name: null },
    ]);

    const { result } = renderHook(() => useChatContext(), { wrapper });

    await act(async () => {
      await result.current.loadSessions('test-paper');
    });

    expect(result.current.activeSessionId['test-paper']).toBe('session-1');

    await act(async () => {
      await result.current.deleteCurrentSession('test-paper');
    });

    expect(mockApi.deleteSession).toHaveBeenCalledWith('test-paper', 'session-1');
    expect(result.current.activeSessionId['test-paper']).toBe('session-2');
    expect(result.current.getMessages('test-paper')).toHaveLength(1);
    expect(result.current.getMessages('test-paper')[0].content).toBe('from second');
  });
});
