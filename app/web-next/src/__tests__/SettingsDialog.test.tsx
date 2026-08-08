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
});
