import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { App } from 'antd';
import BrowsePage from '../pages/BrowsePage';
import type { OverviewEntry, ChunkRow } from '../types';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getOverviewSections: vi.fn(),
    getChunks: vi.fn(),
    getZhChunks: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ api: mockApi }));

function makePaper(
  paperId: string,
  title: string,
  sections: OverviewEntry['sections'],
  hasZh = false,
): OverviewEntry {
  return { paperId, title, year: '2026', hasZh, sections };
}

const chunk = (id: number, chunk_index: number, heading: string, content: string): ChunkRow => ({
  id,
  chunk_index,
  heading,
  heading_level: 2,
  parent_id: null,
  content,
  char_count: content.length,
});

const P1: OverviewEntry = makePaper(
  'p1',
  'Paper One',
  {
    abstract: {
      chunkIndex: 0,
      heading: 'Abstract',
      charCount: 100,
      images: ['images/a.png'],
      chunkIndexes: [0],
    },
    method: {
      chunkIndex: 1,
      heading: 'Method',
      charCount: 100,
      images: [],
      chunkIndexes: [1, 3],
    },
    experiments: {
      chunkIndex: 2,
      heading: 'Experiments',
      charCount: 100,
      images: [],
      chunkIndexes: [2],
    },
  },
  true,
);

const P2: OverviewEntry = makePaper('p2', 'Paper Two', {
  abstract: {
    chunkIndex: 0,
    heading: 'Abstract',
    charCount: 100,
    images: [],
    chunkIndexes: [0],
  },
  method: { chunkIndex: 1, heading: 'Method', charCount: 100, images: [], chunkIndexes: [1] },
});

const P3: OverviewEntry = makePaper('p3', 'Paper Three', {
  method: { chunkIndex: 0, heading: 'Method', charCount: 100, images: [], chunkIndexes: [0] },
});

const CHUNKS: Record<string, ChunkRow[]> = {
  p1: [
    chunk(1, 0, 'Abstract', 'Abstract content of Paper One'),
    chunk(2, 1, 'Method', 'Method content of Paper One'),
    chunk(3, 2, 'Experiments', 'Experiments content of Paper One'),
    chunk(4, 3, 'Method Detail', 'Method detail content of Paper One'),
  ],
  p2: [
    chunk(4, 0, 'Abstract', 'Abstract content of Paper Two'),
    chunk(5, 1, 'Method', 'Method content of Paper Two'),
  ],
  p3: [chunk(6, 0, 'Method', 'Method content of Paper Three')],
};

// 中文译文（仅 p1 有），chunk_index 与原文对齐
const ZH_CHUNKS: Record<string, ChunkRow[]> = {
  p1: [
    chunk(101, 0, '摘要', '论文一的中文摘要译文。'),
    chunk(102, 1, '方法', '论文一的中文方法译文。'),
    chunk(103, 2, '实验', '论文一的中文实验译文。'),
    chunk(104, 3, '方法细节', '论文一的中文方法细节译文。'),
  ],
};

function renderBrowse() {
  return render(
    <App>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/browse']}>
          <Routes>
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/paper/:id" element={<div>阅读页</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </App>,
  );
}

describe('BrowsePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getOverviewSections.mockResolvedValue({ papers: [P1, P2, P3] });
    mockApi.getChunks.mockImplementation((paperId: string) =>
      Promise.resolve(CHUNKS[paperId] ?? []),
    );
    mockApi.getZhChunks.mockImplementation((paperId: string) =>
      Promise.resolve(ZH_CHUNKS[paperId] ?? []),
    );
  });

  it('renders all papers and auto-selects the first with the current section (摘要)', async () => {
    renderBrowse();

    expect(await screen.findByText('Paper One')).toBeInTheDocument();
    expect(screen.getByText('Paper Two')).toBeInTheDocument();
    expect(screen.getByText('Paper Three')).toBeInTheDocument();

    // 默认筛选「摘要」：自动选中第一篇有摘要的论文并加载其内容
    expect(await screen.findByText('Abstract content of Paper One')).toBeInTheDocument();
    // 图片画廊：路径被重写为 /MD/images/
    const img = document.querySelector('img[src="/MD/images/a.png"]');
    expect(img).not.toBeNull();
    // 可浏览论文 = 有摘要的 2 篇
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('switches filter and only keeps papers with that section', async () => {
    renderBrowse();
    await screen.findByText('Abstract content of Paper One');

    // 点击 Segmented「实验」（第一个「实验」文本是筛选按钮）
    fireEvent.click(screen.getAllByText('实验')[0]);

    expect(await screen.findByText('Experiments content of Paper One')).toBeInTheDocument();
    // 只有 Paper One 有实验分区
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('concatenates subsection chunks with their headings for the full section', async () => {
    renderBrowse();
    await screen.findByText('Abstract content of Paper One');

    // 切到「方法」：分区包含顶级段 (1) + 子节 (3)
    fireEvent.click(screen.getAllByText('方法')[0]);

    expect(await screen.findByText('Method content of Paper One')).toBeInTheDocument();
    // 子节内容与子节标题都被拼接进来
    expect(screen.getByText('Method Detail')).toBeInTheDocument();
    expect(screen.getByText('Method detail content of Paper One')).toBeInTheDocument();
  });

  it('shows placeholder when the selected paper lacks the current section', async () => {
    renderBrowse();
    await screen.findByText('Abstract content of Paper One');

    fireEvent.click(screen.getByText('Paper Three'));

    expect(await screen.findByText('该论文没有「摘要」部分')).toBeInTheDocument();
  });

  it('navigates to the next paper via the next button', async () => {
    renderBrowse();
    await screen.findByText('Abstract content of Paper One');

    fireEvent.click(screen.getByTitle('下一篇（→）'));

    expect(await screen.findByText('Abstract content of Paper Two')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('navigates between papers with keyboard arrows', async () => {
    renderBrowse();
    await screen.findByText('Abstract content of Paper One');

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(await screen.findByText('Abstract content of Paper Two')).toBeInTheDocument();
  });

  it('shows empty state when there are no papers', async () => {
    mockApi.getOverviewSections.mockResolvedValue({ papers: [] });
    renderBrowse();

    expect(await screen.findByText('暂无可浏览的论文')).toBeInTheDocument();
  });

  it('switches to Chinese and shows the translated section content', async () => {
    renderBrowse();
    await screen.findByText('Abstract content of Paper One');

    fireEvent.click(screen.getByText('中文'));

    expect(await screen.findByText('论文一的中文摘要译文。')).toBeInTheDocument();
    // 列表里标记有译文的论文
    expect(screen.getByText('有译文')).toBeInTheDocument();
  });

  it('falls back to the original text when the paper has no translation', async () => {
    renderBrowse();
    await screen.findByText('Abstract content of Paper One');

    fireEvent.click(screen.getByText('中文'));
    await screen.findByText('论文一的中文摘要译文。');

    // Paper Two 没有中文翻译 → 显示原文 + 回退提示
    fireEvent.click(screen.getByText('Paper Two'));

    expect(await screen.findByText('Abstract content of Paper Two')).toBeInTheDocument();
    expect(screen.getByText('暂无中文翻译，显示原文')).toBeInTheDocument();
  });
});
