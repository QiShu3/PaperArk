import { useState, useEffect } from 'react';
import { App, Button, Divider, Form, Input, Modal, Segmented, Switch, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DatabaseOutlined, LinkOutlined, LoadingOutlined, LockOutlined, RobotOutlined } from '@ant-design/icons';
import type { Settings, SourceSetting } from '@/types';
import { api } from '@/api';
import { DEFAULT_BASE_URL } from '@/lib/settings';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

interface SourceRow extends SourceSetting {
  keyInput: string;
}

/** 设置界面暂时不展示的源（Semantic Scholar 需配 key、Zenodo 上游 bug）。 */
const HIDDEN_SOURCES = new Set(['semantic', 'zenodo']);

export default function SettingsDialog({ open, onOpenChange, settings, onSettingsChange }: Props) {
  const { message } = App.useApp();
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl || DEFAULT_BASE_URL);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);

  useEffect(() => {
    if (open) {
      setApiKey(settings.apiKey);
      setModel(settings.model);
      setBaseUrl(settings.baseUrl || DEFAULT_BASE_URL);
      setTestResult(null);
      setSources(
        (settings.sources ?? [])
          .filter((s) => !HIDDEN_SOURCES.has(s.source))
          .map((s) => ({
            ...s,
            keyInput: '',
          })),
      );
    }
  }, [open, settings]);

  const updateSource = (source: string, patch: Partial<SourceRow>) => {
    setSources((cur) => cur.map((s) => (s.source === source ? { ...s, ...patch } : s)));
  };

  const handleSave = () => {
    const next: Settings = {
      apiKey: apiKey.trim(),
      model,
      baseUrl: baseUrl.trim() || DEFAULT_BASE_URL,
      sources: sources.map((s) => ({
        source: s.source,
        label: s.label,
        download: s.download,
        note: s.note,
        keyEnv: s.keyEnv,
        keyLabel: s.keyLabel,
        enabled: s.enabled,
        key: s.keyInput.trim() || undefined,
        hasKey: s.hasKey,
      })),
    };
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
      width={520}
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

        <Divider style={{ margin: '4px 0' }} />

        <div>
          <FlexBetween>
            <Typography.Text strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <DatabaseOutlined /> 数据源
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              自动搜索使用的论文来源
            </Typography.Text>
          </FlexBetween>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {sources.map((s) => (
              <div
                key={s.source}
                style={{
                  border: '1px solid rgba(5,5,5,0.08)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  opacity: s.enabled ? 1 : 0.6,
                }}
              >
                <FlexBetween>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Typography.Text strong>{s.label}</Typography.Text>
                    <Tag color={s.download ? 'blue' : 'orange'} style={{ fontSize: 11, marginRight: 0 }}>
                      {s.download ? '可下载 PDF' : '仅元数据'}
                    </Tag>
                  </div>
                  <Switch
                    checked={s.enabled}
                    onChange={(v) => updateSource(s.source, { enabled: v })}
                    size="small"
                    aria-label={`启用 ${s.label}`}
                  />
                </FlexBetween>
                {s.note && (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
                    {s.note}
                  </Typography.Paragraph>
                )}
                {s.keyEnv && (
                  <Input
                    value={s.keyInput}
                    onChange={(e) => updateSource(s.source, { keyInput: e.target.value })}
                    placeholder={s.keyLabel ?? 'API Key'}
                    type="password"
                    size="small"
                    style={{ marginTop: 8 }}
                    suffix={
                      !s.keyInput && s.hasKey ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          已配置
                        </Typography.Text>
                      ) : undefined
                    }
                    aria-label={`${s.label} API Key`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '8px 12px' }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            API Key 与数据源配置保存在服务端 settings.json，通过后端代理转发，全程不经过第三方服务器。
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

function FlexBetween({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      {children}
    </div>
  );
}
