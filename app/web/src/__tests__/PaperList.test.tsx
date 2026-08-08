import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import PaperList from '../pages/PaperList';
import { DirectionProvider, GLOBAL_DIRECTION } from '../context/DirectionContext';
import type { Paper, ResearchConfigDto, TagCount } from '../types';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    listPapers: vi.fn(),
    listTags: vi.fn(),
    search: vi.fn(),
    getResearchConfig: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ api: mockApi }));

const config: ResearchConfigDto = {
  schedule: { cron: '0 9 * * *', timezone: 'Asia/Shanghai' },
  maxPerRun: 5,
  directions: [{ name: '基于扩散模型的对抗攻击', query: 'abs:attack', enabled: true }],
};

const tags: TagCount[] = [{ tag: 'diffusion', count: 2 }];

const papers: Paper[] = [
  {
    id: '2607.00001',
    title: 'Zeta Paper',
    tags: ['diffusion'],
    addedAt: '2026-08-04T10:00:00.000Z',
    year: '2025',
    venue: 'arXiv',
    directions: ['基于扩散模型的对抗攻击'],
    hasMd: true,
    hasPdf: true,
  },
  {
    id: '2607.00002',
    title: 'Alpha Paper',
    tags: [],
    addedAt: '2026-08-05T10:00:00.000Z',
    year: '2026',
    area: '扩散模型防御',
    source: 'arxiv-auto',
    hasMd: false,
    hasPdf: true,
  },
];

function renderPage() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DirectionProvider>
        <MemoryRouter>
          <PaperList />
        </MemoryRouter>
      </DirectionProvider>
    </QueryClientProvider>,
  );
}

describe('PaperList', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockApi.listPapers.mockResolvedValue(papers);
    mockApi.listTags.mockResolvedValue(tags);
    mockApi.getResearchConfig.mockResolvedValue(config);
    mockApi.getSettings.mockResolvedValue({
      apiKey: '',
      model: 'v4-flash',
      baseUrl: 'https://api.deepseek.com/v1',
    });
  });

  it('shows added date, year and direction info on paper rows', async () => {
    renderPage();

    const row = (await screen.findByText('Zeta Paper')).closest(
      '[data-slot="card"]',
    ) as HTMLElement;
    expect(within(row).getByText('arXiv 2025')).toBeInTheDocument();
    expect(within(row).getByText('2026/08/04')).toBeInTheDocument();
    expect(within(row).getByText('基于扩散模型的对抗攻击')).toBeInTheDocument();
  });

  it('filters papers by year', async () => {
    renderPage();

    await screen.findByText('Zeta Paper');
    const yearSelect = screen.getByLabelText('按年份筛选');
    fireEvent.change(yearSelect, { target: { value: '2026' } });

    expect(screen.queryByText('Zeta Paper')).not.toBeInTheDocument();
    expect(screen.getByText('Alpha Paper')).toBeInTheDocument();
    expect(screen.getByText('共 1 篇论文')).toBeInTheDocument();
  });

  it('filters papers by venue badge', async () => {
    renderPage();

    await screen.findByText('Zeta Paper');
    const venueBadge = screen.getByText('arXiv', { selector: '[data-slot="badge"]' });
    fireEvent.click(venueBadge);

    expect(screen.getByText('Zeta Paper')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Paper')).not.toBeInTheDocument();
    expect(screen.getByText('共 1 篇论文')).toBeInTheDocument();

    fireEvent.click(venueBadge);
    expect(screen.getByText('Alpha Paper')).toBeInTheDocument();
  });

  it('shows all venue badges without an expander', async () => {
    const manyVenues: Paper[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((v, i) => ({
      id: `2607.1000${i}`,
      title: `Paper ${v}`,
      tags: [],
      addedAt: `2026-08-0${(i % 9) + 1}T10:00:00.000Z`,
      venue: v,
      hasMd: true,
      hasPdf: true,
    }));
    mockApi.listPapers.mockResolvedValue(manyVenues);
    renderPage();

    await screen.findByText('Paper A');
    for (const v of ['A', 'B', 'C', 'D', 'E', 'F']) {
      expect(screen.getByText(v, { selector: '[data-slot="badge"]' })).toBeInTheDocument();
    }
    expect(screen.queryByText(/更多/)).not.toBeInTheDocument();
  });

  it('filters papers by accepted (中刊) badge', async () => {
    const acceptedPapers: Paper[] = [
      {
        id: '2607.20001',
        title: '已中刊论文',
        tags: [],
        addedAt: '2026-08-04T10:00:00.000Z',
        venue: 'CVPR',
        hasMd: true,
        hasPdf: true,
      },
      {
        id: '2607.20002',
        title: '未中刊论文',
        tags: [],
        addedAt: '2026-08-04T11:00:00.000Z',
        venue: '未收录',
        hasMd: true,
        hasPdf: true,
      },
      {
        id: '2607.20003',
        title: '无刊物论文',
        tags: [],
        addedAt: '2026-08-04T12:00:00.000Z',
        hasMd: false,
        hasPdf: false,
      },
    ];
    mockApi.listPapers.mockResolvedValue(acceptedPapers);
    renderPage();

    await screen.findByText('已中刊论文');
    fireEvent.click(screen.getByText('已中刊'));

    expect(screen.getByText('已中刊论文')).toBeInTheDocument();
    expect(screen.queryByText('未中刊论文')).not.toBeInTheDocument();
    expect(screen.queryByText('无刊物论文')).not.toBeInTheDocument();
    expect(screen.getByText('共 1 篇论文')).toBeInTheDocument();
  });

  it('sorts by newest added first by default and can switch to earliest', async () => {
    renderPage();

    await screen.findByText('Zeta Paper');
    const rows = screen.getAllByRole('link', { name: /Paper$/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Alpha Paper'),
      expect.stringContaining('Zeta Paper'),
    ]);

    const sortSelect = screen.getByLabelText('排序方式');
    fireEvent.change(sortSelect, { target: { value: 'addedAsc' } });

    const sortedRows = screen.getAllByRole('link', { name: /Paper$/ });
    expect(sortedRows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Zeta Paper'),
      expect.stringContaining('Alpha Paper'),
    ]);
  });

  it('falls back to global view when selected direction no longer exists', async () => {
    localStorage.setItem('papers-direction', '不存在的方向');
    renderPage();

    expect(await screen.findByText('Papers 知识库')).toBeInTheDocument();
    expect(await screen.findByText('Zeta Paper')).toBeInTheDocument();
    expect(screen.getByText('Alpha Paper')).toBeInTheDocument();
  });

  it('opens the settings dialog from the home page', async () => {
    renderPage();

    await screen.findByText('Zeta Paper');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(await screen.findByText('API Base URL')).toBeInTheDocument();
    expect(screen.getByText('API Key')).toBeInTheDocument();
  });
});
