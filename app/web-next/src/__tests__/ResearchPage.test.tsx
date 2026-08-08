import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from 'antd';
import ResearchPage from '../pages/ResearchPage';
import { DirectionProvider, GLOBAL_DIRECTION } from '../context/DirectionContext';
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
    startClassify: vi.fn(),
    getClassifyStatus: vi.fn(),
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
    <App>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DirectionProvider>
          <MemoryRouter>
            <ResearchPage />
          </MemoryRouter>
        </DirectionProvider>
      </QueryClientProvider>
    </App>,
  );
}

describe('ResearchPage', () => {
  beforeEach(() => {
    localStorage.clear();
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
    mockApi.startClassify.mockResolvedValue({ started: true });
    mockApi.getClassifyStatus.mockResolvedValue({
      running: false,
      current: 0,
      total: 0,
      matched: 0,
      failed: 0,
      errors: [],
    });
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
    await screen.findByRole('dialog');
    const nameInput = await screen.findByRole('textbox', { name: /名称/ });
    fireEvent.change(nameInput, { target: { value: '新方向' } });
    fireEvent.change(screen.getByRole('textbox', { name: /arXiv 查询词/ }), {
      target: { value: 'abs:new' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

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
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));

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

  it('starts classification of existing papers', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /分类已有论文/ }));

    await waitFor(() => {
      expect(mockApi.startClassify).toHaveBeenCalledTimes(1);
    });
  });

  it('persists the current direction when switched', async () => {
    renderPage();

    const select = await screen.findByRole('combobox', { name: /当前研究方向/ });
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByTitle('基于扩散模型的对抗攻击'));

    await waitFor(() => {
      expect(localStorage.getItem('papers-direction')).toBe('基于扩散模型的对抗攻击');
    });
  });
});
