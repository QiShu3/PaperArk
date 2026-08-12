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
  providers: [{ id: 'deepseek', name: 'DeepSeek', apiKey: '', baseUrl: 'https://api.deepseek.com/v1' }],
  activeProviderId: 'deepseek',
  model: 'v4-flash',
  mineruToken: '',
  sources: [
    { source: 'arxiv', label: 'arXiv', download: true, enabled: true, hasKey: false },
    { source: 'openalex', label: 'OpenAlex', download: false, note: '元数据发现', enabled: true, hasKey: false },
    { source: 'iacr', label: 'IACR', download: true, enabled: true, hasKey: false },
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

  it('renders LLM and MinerU provider entries in the middle column', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /LLM/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /MinerU/ })).toBeInTheDocument();
    expect(screen.getByText('DeepSeek')).toBeInTheDocument();
  });

  it('shows the available models as a vertical list', () => {
    renderDialog();
    expect(screen.getByText('可用模型')).toBeInTheDocument();
    expect(screen.getByText('v4-flash')).toBeInTheDocument();
    expect(screen.getByText('v4-pro')).toBeInTheDocument();
    expect(screen.getAllByText('当前使用').length).toBeGreaterThan(0);
  });

  it('sends the current form values to the test endpoint', async () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '编辑 DeepSeek' }));
    fireEvent.change(screen.getByLabelText('提供商 API Key'), {
      target: { value: 'sk-test' },
    });
    fireEvent.change(screen.getByLabelText('提供商 Base URL'), {
      target: { value: 'https://relay.example.com/v1/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存提供商/ }));

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

    fireEvent.click(screen.getByRole('button', { name: '编辑 DeepSeek' }));
    fireEvent.change(screen.getByLabelText('提供商 API Key'), {
      target: { value: 'sk-bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存提供商/ }));
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));

    expect(await screen.findByText(/HTTP 401：invalid api key/)).toBeInTheDocument();
  });

  it('disables the test button until a provider has an API key', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /测试连接/ })).toBeDisabled();
  });

  it('adds a new provider and persists it on save', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /添加提供商/ }));
    fireEvent.change(screen.getByLabelText('提供商名称'), {
      target: { value: 'MyRelay' },
    });
    fireEvent.change(screen.getByLabelText('提供商 API Key'), {
      target: { value: 'sk-relay' },
    });
    fireEvent.change(screen.getByLabelText('提供商 Base URL'), {
      target: { value: 'https://relay.example.com/v1/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存提供商/ }));

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      const payload = onSettingsChange.mock.calls[0][0] as Settings;
      expect(payload.providers).toHaveLength(2);
      const relay = payload.providers.find((p) => p.name === 'MyRelay');
      expect(relay?.apiKey).toBe('sk-relay');
      expect(relay?.baseUrl).toBe('https://relay.example.com/v1/');
    });
  });

  it('edits and deletes a provider', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /添加提供商/ }));
    fireEvent.change(screen.getByLabelText('提供商名称'), {
      target: { value: 'Second' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保存提供商/ }));
    expect(screen.getByText('Second')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除 Second' }));
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
  });

  it('shows MinerU token input after switching to MinerU', () => {
    renderDialog();
    expect(screen.queryByLabelText('MinerU Token')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /MinerU/ }));
    expect(screen.getByLabelText('MinerU Token')).toBeInTheDocument();
    expect(screen.getByText(/mineru.net\/apiManage\/token/)).toBeInTheDocument();
  });

  it('includes mineruToken in the saved payload', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /MinerU/ }));
    fireEvent.change(screen.getByLabelText('MinerU Token'), {
      target: { value: 'mt-saved' },
    });
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      const payload = onSettingsChange.mock.calls[0][0] as Settings;
      expect(payload.mineruToken).toBe('mt-saved');
    });
  });

  it('shows data sources only after switching to the 数据源 category', () => {
    renderDialog();

    expect(screen.queryByText('arXiv')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /数据源/ }));

    expect(screen.getByText('arXiv')).toBeInTheDocument();
    expect(screen.getByText('OpenAlex')).toBeInTheDocument();
    expect(screen.getByText('IACR')).toBeInTheDocument();
    expect(screen.queryByText('Semantic Scholar')).not.toBeInTheDocument();
    expect(screen.queryByText('Zenodo')).not.toBeInTheDocument();
  });

  it('toggles a source on save', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /数据源/ }));

    const openalexToggle = screen.getByLabelText('启用 OpenAlex');
    fireEvent.click(openalexToggle);

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      const payload = onSettingsChange.mock.calls[0][0] as Settings;
      const openalex = payload.sources?.find((s) => s.source === 'openalex');
      expect(openalex?.enabled).toBe(false);
      const arxiv = payload.sources?.find((s) => s.source === 'arxiv');
      expect(arxiv?.enabled).toBe(true);
      expect(payload.sources?.some((s) => s.source === 'semantic')).toBe(false);
    });
  });
});
