import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { App } from 'antd';
import HomePage from '../pages/HomePage';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listPapers: vi.fn(),
    sciverseStatus: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ api: mockApi }));

function renderHome() {
  return render(
    <App>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/papers" element={<div>论文库页面</div>} />
            <Route path="/sciverse" element={<div>Sciverse 页面</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </App>,
  );
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.listPapers.mockResolvedValue([
      { id: '2607.00001', title: 'A', tags: [], hasMd: true, hasPdf: true },
      { id: '2607.00002', title: 'B', tags: [], hasMd: true, hasPdf: true },
    ]);
    mockApi.sciverseStatus.mockResolvedValue({ enabled: true, tokenConfigured: true });
  });

  it('renders both entry cards', async () => {
    renderHome();

    expect(await screen.findByText('本地论文库')).toBeInTheDocument();
    expect(screen.getByText('Sciverse 工作区')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入本地论文库' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入 Sciverse 工作区' })).toBeInTheDocument();
  });

  it('shows paper count and sciverse connection state', async () => {
    renderHome();

    expect(await screen.findByText('2 篇论文')).toBeInTheDocument();
    expect(await screen.findByText('已连接')).toBeInTheDocument();
  });

  it('shows sciverse state when token is missing', async () => {
    mockApi.sciverseStatus.mockResolvedValue({ enabled: true, tokenConfigured: false });
    renderHome();

    expect(await screen.findByText('未配置 Token')).toBeInTheDocument();
  });

  it('navigates to papers page when clicking the library card', async () => {
    renderHome();

    fireEvent.click(await screen.findByRole('link', { name: '进入本地论文库' }));

    expect(await screen.findByText('论文库页面')).toBeInTheDocument();
  });

  it('navigates to sciverse page when clicking the sciverse card', async () => {
    renderHome();

    fireEvent.click(await screen.findByRole('link', { name: '进入 Sciverse 工作区' }));

    expect(await screen.findByText('Sciverse 页面')).toBeInTheDocument();
  });

  it('still renders cards when stats APIs fail', async () => {
    mockApi.listPapers.mockRejectedValue(new Error('network down'));
    mockApi.sciverseStatus.mockRejectedValue(new Error('network down'));
    renderHome();

    expect(await screen.findByText('本地论文库')).toBeInTheDocument();
    expect(screen.getByText('Sciverse 工作区')).toBeInTheDocument();
    expect(screen.queryByText(/篇论文/)).not.toBeInTheDocument();
    expect(screen.queryByText('已连接')).not.toBeInTheDocument();
  });
});
