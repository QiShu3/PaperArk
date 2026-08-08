import { useState, useEffect } from 'react';
import { App, Button, Form, Input, Modal, Segmented, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LinkOutlined, LoadingOutlined, LockOutlined, RobotOutlined } from '@ant-design/icons';
import type { Settings } from '@/types';
import { api } from '@/api';
import { DEFAULT_BASE_URL } from '@/lib/settings';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

export default function SettingsDialog({ open, onOpenChange, settings, onSettingsChange }: Props) {
  const { message } = App.useApp();
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl || DEFAULT_BASE_URL);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (open) {
      setApiKey(settings.apiKey);
      setModel(settings.model);
      setBaseUrl(settings.baseUrl || DEFAULT_BASE_URL);
      setTestResult(null);
    }
  }, [open, settings]);

  const handleSave = () => {
    const next: Settings = { apiKey: apiKey.trim(), model, baseUrl: baseUrl.trim() || DEFAULT_BASE_URL };
    onSettingsChange(next);
    onOpenChange(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testSettings({
        apiKey: apiKey.trim(),
        model,
        baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
      });
      setTestResult(
        r.ok
          ? { ok: true, message: `连接成功：${r.model} 响应 ${r.latencyMs ?? '-'}ms` }
          : { ok: false, message: r.error || '连接失败' },
      );
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => onOpenChange(false)}
      title="设置"
      okText="保存"
      cancelText="取消"
      onOk={handleSave}
      width={480}
      destroyOnHidden
    >
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            API Key
          </Typography.Text>
          <Input.Password
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            prefix={<LockOutlined />}
            iconRender={(visible) => <span style={{ fontSize: 12, cursor: 'pointer' }}>{visible ? '隐藏' : '显示'}</span>}
            visibilityToggle={{ visible: showKey, onVisibleChange: setShowKey }}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
              注册 DeepSeek API Key
            </a>
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            默认模型
          </Typography.Text>
          <Segmented
            value={model}
            onChange={(v) => setModel(String(v))}
            options={[
              { label: 'v4-flash（快速）', value: 'v4-flash' },
              { label: 'v4-pro（深度）', value: 'v4-pro' },
            ]}
          />
        </div>

        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            API Base URL
          </Typography.Text>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={DEFAULT_BASE_URL}
            prefix={<LinkOutlined />}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
            任意 OpenAI 兼容端点（如 DeepSeek、代理或中转服务），模型统一使用 deepseek-v4-flash / deepseek-v4-pro。
          </Typography.Paragraph>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '8px 12px' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            API Key 与 Base URL 保存在服务端 settings.json，通过后端代理转发，全程不经过第三方服务器。
          </Typography.Text>
        </div>

        {testResult && (
          <div
            style={{
              borderRadius: 8,
              padding: '8px 12px',
              background: testResult.ok ? 'rgba(0,180,0,0.08)' : 'rgba(255,0,0,0.06)',
            }}
          >
            <Typography.Text type={testResult.ok ? 'success' : 'danger'} style={{ fontSize: 13 }}>
              {testResult.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}{' '}
              {testResult.message}
            </Typography.Text>
          </div>
        )}

        <Button
          onClick={handleTest}
          disabled={testing || !apiKey.trim()}
          icon={testing ? <LoadingOutlined /> : <RobotOutlined />}
        >
          {testing ? '测试中…' : '测试连接'}
        </Button>
      </div>
    </Modal>
  );
}
