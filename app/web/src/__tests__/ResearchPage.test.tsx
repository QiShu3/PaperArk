import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ResearchPage from '../pages/ResearchPage';
import type { ResearchConfigDto, ResearchRun } from '../types';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getResearchConfig: vi.fn(),
    getResearchStatus: vi.fn(),
    getResearchRuns: vi.fn(),
    createResearchDirection: vi.fn(),
    updateResearchDirection: vi.fn(),
    deleteResearchDirection: vi.fn(),
    checkResearch: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ api: mockApi }));

const config: ResearchConfigDto = {
  schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
  maxPerRun: 5,
  directions: [
    {
      name: '基于扩散模型的对抗攻击',
      query: 'abs:"diffusion model" AND abs:adversarial AND abs:attack',
      enabled: true,
      maxPerRun: 3,
    },
  ],
};

const run: ResearchRun = {
  runId: 'run-123',
  startedAt: '2026-08-04T12:00:00.000Z',
  finishedAt: '2026-08-04T12:01:00.000Z',
  status: 'success',
  directions: [
    {
      direction: '基于扩散模型的对抗攻击',
      query: 'abs:"diffusion model" AND abs:adversarial AND abs:attack',
      papers: [
        { id: '2607.28936', arxivId: '2607.28936v1', title: 'DiffAttack', status: 'added' },
        { id: '2607.11111', arxivId: '2607.11111v1', title: 'Old Paper', status: 'duplicate' },
      ],
    },
  ],
};

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ResearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ResearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getResearchConfig.mockResolvedValue(config);
    mockApi.getResearchStatus.mockResolvedValue({ running: false, run: null });
    mockApi.getResearchRuns.mockResolvedValue([run]);
    mockApi.createResearchDirection.mockResolvedValue({
      name: '新方向',
      query: 'abs:new',
      enabled: true,
    });
    mockApi.deleteResearchDirection.mockResolvedValue({ ok: true });
    mockApi.checkResearch.mockResolvedValue({ runId: 'run-new' });
  });

  it('renders directions, schedule info and run history', async () => {
    renderPage();

    expect(await screen.findByText('研究方向 · 自动收录')).toBeInTheDocument();
    expect(await screen.findByText(/定时 0 9/)).toBeInTheDocument();
    expect(screen.getAllByText('基于扩散模型的对抗攻击').length).toBeGreaterThan(0);
    expect(screen.getByText('运行历史')).toBeInTheDocument();
    expect(await screen.findByText('run-123')).toBeInTheDocument();
    expect(screen.getByText('DiffAttack')).toBeInTheDocument();
  });

  it('creates a new direction from the dialog', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /新增方向/ }));
    const nameInput = await screen.findByLabelText('名称');
    fireEvent.change(nameInput, { target: { value: '新方向' } });
    fireEvent.change(screen.getByLabelText('arXiv 查询词'), { target: { value: 'abs:new' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(mockApi.createResearchDirection).toHaveBeenCalledWith({
        name: '新方向',
        query: 'abs:new',
        enabled: true,
        maxPerRun: undefined,
      });
    });
  });

  it('deletes a direction after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(mockApi.deleteResearchDirection).toHaveBeenCalledWith('基于扩散模型的对抗攻击');
    });
  });

  it('starts a manual check', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /立即检查/ }));

    await waitFor(() => {
      expect(mockApi.checkResearch).toHaveBeenCalledTimes(1);
    });
  });
});
