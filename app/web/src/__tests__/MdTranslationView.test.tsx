import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MdTranslationView from '../components/MdTranslationView';
import type { MdTranslationRecord } from '../types';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getMdTranslateStatus: vi.fn(),
    startMdTranslate: vi.fn(),
    cancelMdTranslate: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ api: mockApi }));

const idle: MdTranslationRecord = { paperId: 'p1', status: 'idle' };
const running: MdTranslationRecord = {
  paperId: 'p1',
  status: 'running',
  startedAt: '2026-08-07T10:00:00.000Z',
  progress: { done: 2, total: 5 },
};
const done: MdTranslationRecord = {
  paperId: 'p1',
  status: 'done',
  finishedAt: '2026-08-07T10:01:00.000Z',
  content: '# 中文标题\n\n这是翻译后的正文内容。',
};
const failed: MdTranslationRecord = {
  paperId: 'p1',
  status: 'failed',
  finishedAt: '2026-08-07T10:01:00.000Z',
  error: '翻译请求失败 (HTTP 429)',
};

const ORIGINAL_MD = '# Original Title\n\nOriginal body text.';

describe('MdTranslationView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getMdTranslateStatus.mockResolvedValue(idle);
  });

  it('shows original markdown by default and offers translation', async () => {
    render(<MdTranslationView paperId="p1" markdown={ORIGINAL_MD} />);

    expect(await screen.findByText('Original Title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(await screen.findByRole('button', { name: /翻译为中文/ })).toBeInTheDocument();
  });

  it('starts translation on click and shows progress', async () => {
    mockApi.startMdTranslate.mockResolvedValue(running);
    render(<MdTranslationView paperId="p1" markdown={ORIGINAL_MD} />);

    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    fireEvent.click(await screen.findByRole('button', { name: /翻译为中文/ }));

    await waitFor(() => {
      expect(mockApi.startMdTranslate).toHaveBeenCalledWith('p1');
    });
    expect(await screen.findByText(/翻译中 2\/5/)).toBeInTheDocument();
  });

  it('renders the translated markdown when done', async () => {
    mockApi.getMdTranslateStatus.mockResolvedValue(done);
    render(<MdTranslationView paperId="p1" markdown={ORIGINAL_MD} />);

    fireEvent.click(await screen.findByRole('button', { name: '中文' }));
    expect(await screen.findByText('中文标题')).toBeInTheDocument();
    expect(screen.getByText('这是翻译后的正文内容。')).toBeInTheDocument();
  });

  it('shows the error and retry when failed', async () => {
    mockApi.getMdTranslateStatus.mockResolvedValue(failed);
    render(<MdTranslationView paperId="p1" markdown={ORIGINAL_MD} />);

    fireEvent.click(await screen.findByRole('button', { name: '中文' }));
    expect(await screen.findByText(/HTTP 429/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
  });

  it('cancels a running translation', async () => {
    mockApi.startMdTranslate.mockResolvedValue(running);
    mockApi.cancelMdTranslate.mockResolvedValue({
      ...running,
      status: 'cancelled',
      finishedAt: '2026-08-07T10:00:05.000Z',
    });
    render(<MdTranslationView paperId="p1" markdown={ORIGINAL_MD} />);

    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    fireEvent.click(await screen.findByRole('button', { name: /翻译为中文/ }));
    fireEvent.click(await screen.findByRole('button', { name: /取消/ }));

    await waitFor(() => {
      expect(mockApi.cancelMdTranslate).toHaveBeenCalledWith('p1');
    });
    expect(await screen.findByText(/翻译已取消/)).toBeInTheDocument();
  });
});
