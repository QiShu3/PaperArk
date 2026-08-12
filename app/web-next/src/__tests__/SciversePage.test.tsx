import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from 'antd';
import SciversePage from '../pages/SciversePage';
import { DirectionProvider } from '../context/DirectionContext';
import type { SciverseStatus, SciverseFavorite } from '../types';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    sciverseStatus: vi.fn(),
    sciverseListFavorites: vi.fn(),
    sciverseRemoveFavorite: vi.fn(),
    sciversePromote: vi.fn(),
    sciverseSemanticSearch: vi.fn(),
    sciverseSearchPapers: vi.fn(),
    sciverseContent: vi.fn(),
    sciverseRelations: vi.fn(),
    sciverseResourceUrl: vi.fn(),
    sciverseAddFavorite: vi.fn(),
    listPapers: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ api: mockApi }));

vi.mock('@/context/ChatContext', () => ({
  useChatContext: () => ({
    loadSessions: vi.fn().mockResolvedValue(''),
    createNewSession: vi.fn().mockResolvedValue({ id: 's1' }),
    deleteCurrentSession: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn(),
    activeSessionId: { __sciverse__: '' },
    sessionList: { __sciverse__: [] },
    getMessages: vi.fn().mockReturnValue([]),
    isLoaded: vi.fn().mockReturnValue(true),
    loadHistory: vi.fn().mockResolvedValue(undefined),
    getLoadError: vi.fn().mockReturnValue(null),
    getPersistError: vi.fn().mockReturnValue(null),
    clearError: vi.fn(),
    appendMessage: vi.fn(),
    updateLastAssistant: vi.fn(),
    updateLastAssistantToolCalls: vi.fn(),
    persistSession: vi.fn().mockResolvedValue(undefined),
    setCacheRate: vi.fn(),
    rollbackLastRound: vi.fn().mockResolvedValue(undefined),
  }),
}));

const status: SciverseStatus = { enabled: true, tokenConfigured: true };
const fav: SciverseFavorite = {
  doc_id: 'd_fav1',
  title: 'Diffusion Adversarial Attacks',
  authors: ['A'],
  year: '2026',
  venue: 'arXiv',
  addedAt: '2026-08-12T00:00:00.000Z',
};

function renderPage() {
  return render(
    <App>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DirectionProvider>
          <MemoryRouter>
            <SciversePage />
          </MemoryRouter>
        </DirectionProvider>
      </QueryClientProvider>
    </App>,
  );
}

describe('SciversePage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockApi.sciverseStatus.mockResolvedValue(status);
    mockApi.sciverseListFavorites.mockResolvedValue({ items: [fav] });
    mockApi.sciverseRemoveFavorite.mockResolvedValue({ ok: true });
    mockApi.sciversePromote.mockResolvedValue({
      status: 'added',
      paper: { id: 'sciverse-d_fav1', title: 'Diffusion Adversarial Attacks', tags: [], hasMd: true, hasPdf: false },
    });
  });

  it('renders the workspace header and connected tag', async () => {
    renderPage();
    expect(screen.getByText('Sciverse 工作区')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('已连接')).toBeInTheDocument());
  });

  it('shows guidance when token is not configured', async () => {
    mockApi.sciverseStatus.mockResolvedValue({ enabled: true, tokenConfigured: false });
    renderPage();
    await waitFor(() => expect(screen.getByText('未配置 Token')).toBeInTheDocument());
  });

  it('lists favorites from the collection', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Diffusion Adversarial Attacks')).toBeInTheDocument());
    expect(screen.getByText(/共 1 篇/)).toBeInTheDocument();
  });

  it('removes a favorite after confirm', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Diffusion Adversarial Attacks')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('移除收藏'));
    const dialog = await screen.findByRole('dialog');
    const ok = Array.from(dialog.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').includes('移') && (b.textContent ?? '').includes('除'),
    );
    expect(ok).toBeTruthy();
    fireEvent.click(ok as HTMLElement);
    await waitFor(() => expect(mockApi.sciverseRemoveFavorite).toHaveBeenCalledWith('d_fav1'));
  });

  it('promotes a favorite to the formal library', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('转正式')).toBeInTheDocument());
    fireEvent.click(screen.getByText('转正式'));
    await waitFor(() => expect(mockApi.sciversePromote).toHaveBeenCalledWith('d_fav1', expect.objectContaining({ title: 'Diffusion Adversarial Attacks' })));
  });

  it('renders the chat panel with sciverse mode', async () => {
    renderPage();
    expect(screen.getByText('Sciverse 文献助手')).toBeInTheDocument();
  });
});
