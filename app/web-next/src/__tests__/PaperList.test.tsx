import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from 'antd';
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
  directions: [{ name: '基于扩散模型的对抗攻击', enabled: true, queries: [{ source: 'arxiv', query: 'abs:attack' }] }],
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
    sourceId: '2607.00002',
    doi: '10.1234/alpha',
    hasMd: false,
    hasPdf: true,
  },
];

function renderPage() {
  return render(
    <App>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DirectionProvider>
          <MemoryRouter>
            <PaperList />
          </MemoryRouter>
        </DirectionProvider>
      </QueryClientProvider>
    </App>,
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

    await screen.findByText('Zeta Paper');
    expect(screen.getByText('arXiv 2025')).toBeInTheDocument();
    expect(screen.getByText('2026/08/04')).toBeInTheDocument();
    expect(screen.getByText('基于扩散模型的对抗攻击')).toBeInTheDocument();
  });

  it('filters papers by year', async () => {
    renderPage();

    await screen.findByText('Zeta Paper');
    const yearSelect = screen.getByLabelText('按年份筛选');
    fireEvent.mouseDown(yearSelect);
    fireEvent.click(await screen.findByText('2026', { selector: '.ant-select-item-option-content' }));

    await waitFor(() => {
      expect(screen.queryByText('Zeta Paper')).not.toBeInTheDocument();
      expect(screen.getByText('Alpha Paper')).toBeInTheDocument();
      expect(screen.getByText('共 1 篇论文')).toBeInTheDocument();
    });
  });

  it('filters papers by venue badge', async () => {
    renderPage();

    await screen.findByText('Zeta Paper');
    const venueBadge = screen.getByLabelText('筛选 arXiv');
    fireEvent.click(venueBadge);

    await waitFor(() => {
      expect(screen.getByText('Zeta Paper')).toBeInTheDocument();
      expect(screen.queryByText('Alpha Paper')).not.toBeInTheDocument();
      expect(screen.getByText('共 1 篇论文')).toBeInTheDocument();
    });
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
      expect(screen.getByLabelText(`筛选 ${v}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(/更多/)).not.toBeInTheDocument();
  });

  it('filters papers by source badge', async () => {
    const multiSourcePapers: Paper[] = [
      { ...papers[0] },
      { ...papers[1] },
      {
        id: 'openalex-W999',
        title: 'OpenAlex Paper',
        tags: [],
        addedAt: '2026-08-06T10:00:00.000Z',
        source: 'openalex-auto',
        sourceId: 'W999',
        hasMd: true,
        hasPdf: false,
      },
    ];
    mockApi.listPapers.mockResolvedValue(multiSourcePapers);
    renderPage();

    await screen.findByText('Zeta Paper');
    fireEvent.click(screen.getByLabelText('筛选来源 OpenAlex'));

    await waitFor(() => {
      expect(screen.getByText('OpenAlex Paper')).toBeInTheDocument();
      expect(screen.queryByText('Zeta Paper')).not.toBeInTheDocument();
      expect(screen.queryByText('Alpha Paper')).not.toBeInTheDocument();
      expect(screen.getByText('共 1 篇论文')).toBeInTheDocument();
    });
  });

  it('filters papers that have a DOI', async () => {
    renderPage();

    await screen.findByText('Zeta Paper');
    fireEvent.click(screen.getByText('有 DOI'));

    await waitFor(() => {
      expect(screen.getByText('Alpha Paper')).toBeInTheDocument();
      expect(screen.queryByText('Zeta Paper')).not.toBeInTheDocument();
      expect(screen.getByText('共 1 篇论文')).toBeInTheDocument();
    });
  });

  it('shows accepted (中刊) badge', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('已中刊论文')).toBeInTheDocument();
      expect(screen.queryByText('未中刊论文')).not.toBeInTheDocument();
      expect(screen.queryByText('无刊物论文')).not.toBeInTheDocument();
      expect(screen.getByText('共 1 篇论文')).toBeInTheDocument();
    });
  });

  it('sorts by newest added first by default and can switch to earliest', async () => {
    renderPage();

    await screen.findByText('Zeta Paper');
    const links = screen.getAllByRole('link', { name: /Paper$/ });
    expect(links.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Alpha Paper'),
      expect.stringContaining('Zeta Paper'),
    ]);

    const sortSelect = screen.getByLabelText('排序方式');
    fireEvent.mouseDown(sortSelect);
    fireEvent.click(await screen.findByText('最早收录'));

    await waitFor(() => {
      const sortedLinks = screen.getAllByRole('link', { name: /Paper$/ });
      expect(sortedLinks.map((r) => r.textContent)).toEqual([
        expect.stringContaining('Zeta Paper'),
        expect.stringContaining('Alpha Paper'),
      ]);
    });
  });

  it('falls back to global view when selected direction no longer exists', async () => {
    localStorage.setItem('papers-direction', '不存在的方向');
    renderPage();

    expect(await screen.findByText('Papers 知识库')).toBeInTheDocument();
    expect(await screen.findByText('Zeta Paper')).toBeInTheDocument();
    expect(screen.getByText('Alpha Paper')).toBeInTheDocument();
  });

  it('opens the settings dialog from the papers page', async () => {
    renderPage();

    await screen.findByText('Zeta Paper');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(await screen.findByText('LLM 提供商')).toBeInTheDocument();
    expect(screen.getByText('DeepSeek')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MinerU/ })).toBeInTheDocument();
  });
});
