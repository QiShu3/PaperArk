import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { App } from 'antd';
import ChatPanel from '../components/ChatPanel';
import { DirectionProvider } from '../context/DirectionContext';

const { mockApi, mockCtx, resetStore } = vi.hoisted(() => {
  let store: { role: string; content: string; tool_calls?: unknown[] }[] = [];
  const mockCtx = {
    getMessages: vi.fn(() => store),
    isLoaded: vi.fn().mockReturnValue(true),
    loadHistory: vi.fn().mockResolvedValue(undefined),
    getLoadError: vi.fn().mockReturnValue(null),
    getPersistError: vi.fn().mockReturnValue(null),
    clearError: vi.fn(),
    appendMessage: vi.fn((_paperId: string, msg: { role: string; content: string }) => {
      store = [...store, msg];
    }),
    updateLastAssistant: vi.fn((_paperId: string, content: string) => {
      store = store.map((m, i) => (i === store.length - 1 ? { ...m, content } : m));
    }),
    updateLastAssistantToolCalls: vi.fn(),
    persistSession: vi.fn().mockResolvedValue(undefined),
    setCacheRate: vi.fn(),
    rollbackLastRound: vi.fn().mockResolvedValue(undefined),
    createNewSession: vi.fn().mockResolvedValue({ id: 's1' }),
    deleteCurrentSession: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn(),
    loadSessions: vi.fn().mockResolvedValue('s1'),
    activeSessionId: { __sciverse__: 's1' },
    sessionList: { __sciverse__: [{ id: 's1', paper_id: '__sciverse__', title: '会话 1', created_at: '', updated_at: '' }] },
  };
  const mockApi = {
    chat: vi.fn(),
    generateSessionTitle: vi.fn(),
    getChunks: vi.fn().mockResolvedValue([]),
    reportRoundLog: vi.fn().mockResolvedValue({ ok: true }),
  };
  return { mockApi, mockCtx, resetStore: () => { store = []; } };
});

vi.mock('@/api', () => ({ api: mockApi }));
vi.mock('@/context/ChatContext', () => ({ useChatContext: () => mockCtx }));

async function* streamOnce(text: string) {
  yield { type: 'content', text };
  yield { type: 'usage', hit: 0, miss: 1 };
}

function renderPanel() {
  return render(
    <App>
      <DirectionProvider>
        <ChatPanel mode="sciverse" apiKey="test-key" model="v4-flash" onModelChange={vi.fn()} />
      </DirectionProvider>
    </App>,
  );
}

async function sendMessage(text: string) {
  const textarea = screen.getByPlaceholderText(/问任何关于全球文献的问题/) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  fireEvent.keyUp(textarea, { key: 'Enter' });
}

describe('ChatPanel auto session title', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mockApi.chat.mockImplementationOnce(async function* () {
      yield { type: 'content', text: 'answer' };
    });
  });

  it('generates a title on the first message and renames the session', async () => {
    mockApi.generateSessionTitle.mockResolvedValue({ ok: true, title: '扩散模型对抗攻击' });
    renderPanel();
    await sendMessage('最近扩散模型对抗攻击有什么新进展');

    await waitFor(() => expect(mockApi.generateSessionTitle).toHaveBeenCalledWith(
      '最近扩散模型对抗攻击有什么新进展',
      'v4-flash',
      'test-key',
    ));
    await waitFor(() => expect(mockCtx.renameSession).toHaveBeenCalledWith('__sciverse__', 's1', '扩散模型对抗攻击'));
  });

  it('does not fail when title generation errors', async () => {
    mockApi.generateSessionTitle.mockRejectedValue(new Error('upstream down'));
    renderPanel();
    await sendMessage('总结一下 transformer 的原理');

    await waitFor(() => expect(mockApi.generateSessionTitle).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('answer')).toBeInTheDocument());
    expect(mockCtx.renameSession).not.toHaveBeenCalled();
  });
});
