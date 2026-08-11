import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from 'antd';
import SettingsDialog from '../components/SettingsDialog';
import type { Settings } from '../types';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    testSettings: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ api: mockApi }));

const settings: Settings = {
  apiKey: '',
  model: 'v4-flash',
  baseUrl: 'https://api.deepseek.com/v1',
  sources: [
    { source: 'arxiv', label: 'arXiv', download: true, enabled: true, hasKey: false },
    { source: 'openalex', label: 'OpenAlex', download: false, note: '元数据发现', enabled: true, hasKey: false },
    {
      source: 'semantic',
      label: 'Semantic Scholar',
      download: true,
      keyEnv: 'PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY',
      keyLabel: 'Semantic Scholar API Key',
      note: '免费 key 可提升限流',
      enabled: false,
      hasKey: true,
    },
  ],
};

function renderDialog() {
  return render(
    <App>
      <SettingsDialog
        open
        onOpenChange={vi.fn()}
        settings={settings}
        onSettingsChange={vi.fn()}
      />
    </App>,
  );
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.testSettings.mockResolvedValue({
      ok: true,
      model: 'deepseek-v4-flash',
      latencyMs: 320,
    });
  });

  it('sends the current form values to the test endpoint', async () => {
    renderDialog();

    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'sk-test' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://api.deepseek.com/v1'), {
      target: { value: 'https://relay.example.com/v1/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));

    await waitFor(() => {
      expect(mockApi.testSettings).toHaveBeenCalledWith({
        apiKey: 'sk-test',
        model: 'v4-flash',
        baseUrl: 'https://relay.example.com/v1/',
      });
    });
    expect(await screen.findByText(/连接成功：deepseek-v4-flash 响应 320ms/)).toBeInTheDocument();
  });

  it('shows the upstream error message', async () => {
    mockApi.testSettings.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'HTTP 401：invalid api key',
    });
    renderDialog();

    fireEvent.change(screen.getByPlaceholderText('sk-...'), {
      target: { value: 'sk-bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));

    expect(await screen.findByText(/HTTP 401：invalid api key/)).toBeInTheDocument();
  });

  it('disables the test button until an API key is entered', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /测试连接/ })).toBeDisabled();
  });

  it('renders data sources with capability tags and key inputs', () => {
    renderDialog();

    expect(screen.getByText('数据源')).toBeInTheDocument();
    expect(screen.getByText('arXiv')).toBeInTheDocument();
    expect(screen.getAllByText('可下载 PDF').length).toBeGreaterThan(0);
    expect(screen.getByText('OpenAlex')).toBeInTheDocument();
    expect(screen.getByText('仅元数据')).toBeInTheDocument();
    expect(screen.getByText('Semantic Scholar')).toBeInTheDocument();
    expect(screen.getByLabelText('Semantic Scholar API Key')).toBeInTheDocument();
    expect(screen.getByText('已配置')).toBeInTheDocument();
  });

  it('toggles a source and submits its key on save', async () => {
    const onSettingsChange = vi.fn();
    render(
      <App>
        <SettingsDialog
          open
          onOpenChange={vi.fn()}
          settings={settings}
          onSettingsChange={onSettingsChange}
        />
      </App>,
    );

    const semanticToggle = screen.getByLabelText('启用 Semantic Scholar');
    fireEvent.click(semanticToggle);

    fireEvent.change(screen.getByLabelText('Semantic Scholar API Key'), {
      target: { value: 's2-new-key' },
    });

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: expect.arrayContaining([
            expect.objectContaining({ source: 'semantic', enabled: true, key: 's2-new-key' }),
          ]),
        }),
      );
    });
    const payload = onSettingsChange.mock.calls[0][0] as Settings;
    const semantic = payload.sources?.find((s) => s.source === 'semantic');
    expect(semantic?.enabled).toBe(true);
    expect(semantic?.key).toBe('s2-new-key');
    const arxiv = payload.sources?.find((s) => s.source === 'arxiv');
    expect(arxiv?.enabled).toBe(true);
  });
});
