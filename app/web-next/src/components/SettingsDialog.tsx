import { useState, useEffect } from 'react';
import { Button, Divider, Input, Modal, Switch, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  LinkOutlined,
  LoadingOutlined,
  LockOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import type { Settings, SourceSetting, LLMProvider } from '@/types';
import { api } from '@/api';
import { DEFAULT_BASE_URL, defaultProviders } from '@/lib/settings';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

interface SourceRow extends SourceSetting {
  keyInput: string;
}

type CategoryKey = 'model' | 'sources';
type ProviderKey = 'llm' | 'mineru' | 'sciverse';

interface ProviderForm {
  id?: string;
  name: string;
  apiKey: string;
  baseUrl: string;
}

/** 设置界面暂时不展示的源（Semantic Scholar 需配 key、Zenodo 上游 bug）。 */
const HIDDEN_SOURCES = new Set(['semantic', 'zenodo']);

export default function SettingsDialog({ open, onOpenChange, settings, onSettingsChange }: Props) {
  const [model, setModel] = useState(settings.model);
  const [mineruToken, setMineruToken] = useState(settings.mineruToken || '');
  const [sciverseToken, setSciverseToken] = useState(settings.sciverseToken || '');
  const [providers, setProviders] = useState<LLMProvider[]>(settings.providers ?? defaultProviders());
  const [activeProviderId, setActiveProviderId] = useState(
    settings.activeProviderId || settings.providers?.[0]?.id || 'deepseek',
  );
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [category, setCategory] = useState<CategoryKey>('model');
  const [provider, setProvider] = useState<ProviderKey>('llm');
  const [providerForm, setProviderForm] = useState<ProviderForm | null>(null);

  useEffect(() => {
    if (open) {
      setModel(settings.model);
      setMineruToken(settings.mineruToken || '');
      setSciverseToken(settings.sciverseToken || '');
      setProviders(settings.providers ?? defaultProviders());
      setActiveProviderId(settings.activeProviderId || settings.providers?.[0]?.id || 'deepseek');
      setTestResult(null);
      setSources(
        (settings.sources ?? [])
          .filter((s) => !HIDDEN_SOURCES.has(s.source))
          .map((s) => ({
            ...s,
            keyInput: '',
          })),
      );
      setCategory('model');
      setProvider('llm');
      setProviderForm(null);
    }
  }, [open, settings]);

  const updateSource = (source: string, patch: Partial<SourceRow>) => {
    setSources((cur) => cur.map((s) => (s.source === source ? { ...s, ...patch } : s)));
  };

  const updateProvider = (id: string, patch: Partial<LLMProvider>) => {
    setProviders((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const deleteProvider = (id: string) => {
    setProviders((cur) => {
      const next = cur.filter((p) => p.id !== id);
      if (activeProviderId === id) setActiveProviderId(next[0]?.id ?? '');
      return next;
    });
  };

  const saveProviderForm = () => {
    if (!providerForm) return;
    const baseUrl = providerForm.baseUrl.trim() || DEFAULT_BASE_URL;
    if (providerForm.id) {
      setProviders((cur) =>
        cur.map((p) => (p.id === providerForm.id ? { ...p, name: providerForm.name.trim() || p.id, apiKey: providerForm.apiKey.trim(), baseUrl } : p)),
      );
    } else {
      const id = (providerForm.name.trim() || `provider-${Date.now()}`)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-');
      const idUnique = providers.some((p) => p.id === id) ? `${id}-${Date.now()}` : id;
      setProviders((cur) => [
        ...cur,
        { id: idUnique, name: providerForm.name.trim() || idUnique, apiKey: providerForm.apiKey.trim(), baseUrl },
      ]);
    }
    setProviderForm(null);
  };

  const handleSave = () => {
    const next: Settings = {
      providers,
      activeProviderId,
      model,
      mineruToken: mineruToken.trim(),
      sciverseToken: sciverseToken.trim(),
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
    const active = providers.find((p) => p.id === activeProviderId) ?? providers[0];
    try {
      const r = await api.testSettings({
        apiKey: active?.apiKey ?? '',
        model,
        baseUrl: active?.baseUrl || DEFAULT_BASE_URL,
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

  const categories: { key: CategoryKey; label: string; icon: React.ReactNode }[] = [
    { key: 'model', label: '模型', icon: <RobotOutlined /> },
    { key: 'sources', label: '数据源', icon: <DatabaseOutlined /> },
  ];

  const active = providers.find((p) => p.id === activeProviderId) ?? providers[0];

  return (
    <Modal
      open={open}
      onCancel={() => onOpenChange(false)}
      title="设置"
      okText="保存"
      cancelText="取消"
      onOk={handleSave}
      width={820}
      destroyOnHidden
    >
      <div style={{ display: 'flex', marginTop: 8, minHeight: 420 }}>
        {/* 左侧分类导航 */}
        <div
          style={{
            width: 120,
            flexShrink: 0,
            borderRight: '1px solid rgba(5,5,5,0.08)',
            marginRight: 16,
            paddingRight: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(c.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13,
                background: category === c.key ? 'rgba(22,119,255,0.1)' : 'transparent',
                color: category === c.key ? '#1677ff' : 'inherit',
                fontWeight: category === c.key ? 600 : 400,
              }}
            >
              {c.icon}
              {c.label}
            </button>
          ))}
        </div>

        {category === 'sources' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
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

            <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 8, padding: '8px 12px', marginTop: 16 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                API Key 与数据源配置保存在服务端 settings.json，通过后端代理转发，全程不经过第三方服务器。
              </Typography.Text>
            </div>
          </div>
        )}

        {category === 'model' && (
          <>
            {/* 中栏：提供商类型列表 */}
            <div
              style={{
                width: 160,
                flexShrink: 0,
                borderRight: '1px solid rgba(5,5,5,0.08)',
                marginRight: 16,
                paddingRight: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 11, padding: '4px 12px' }}>
                提供商
              </Typography.Text>
              <button
                type="button"
                onClick={() => setProvider('llm')}
                style={navItemStyle(provider === 'llm')}
              >
                <RobotOutlined />
                <span style={{ flex: 1 }}>LLM</span>
                <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
                  {providers.some((p) => p.apiKey) ? '✓' : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setProvider('mineru')}
                style={navItemStyle(provider === 'mineru')}
              >
                <FileTextOutlined />
                <span style={{ flex: 1 }}>MinerU</span>
                <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
                  {mineruToken ? '✓' : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setProvider('sciverse')}
                style={navItemStyle(provider === 'sciverse')}
              >
                <LinkOutlined />
                <span style={{ flex: 1 }}>Sciverse</span>
                <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>
                  {sciverseToken ? '✓' : ''}
                </span>
              </button>
            </div>

            {/* 右栏：提供商详情 */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {provider === 'llm' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <FlexBetween>
                      <Typography.Text strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        LLM 提供商
                      </Typography.Text>
                      <Button
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => setProviderForm({ name: '', apiKey: '', baseUrl: DEFAULT_BASE_URL })}
                      >
                        添加提供商
                      </Button>
                    </FlexBetween>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                      {providers.map((p) => (
                        <div
                          key={p.id}
                          style={{
                            border: '1px solid rgba(5,5,5,0.08)',
                            borderRadius: 8,
                            padding: '8px 12px',
                          }}
                        >
                          <FlexBetween>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Typography.Text strong>{p.name}</Typography.Text>
                              {p.id === activeProviderId && (
                                <Tag color="green" style={{ fontSize: 11, marginRight: 0 }}>
                                  当前使用
                                </Tag>
                              )}
                              {p.apiKey ? (
                                <Tag color="blue" style={{ fontSize: 11, marginRight: 0 }}>
                                  已配置
                                </Tag>
                              ) : (
                                <Tag color="default" style={{ fontSize: 11, marginRight: 0 }}>
                                  未配置
                                </Tag>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {p.id !== activeProviderId && (
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => setActiveProviderId(p.id)}
                                >
                                  设为默认
                                </Button>
                              )}
                              <Button
                                size="small"
                                type="text"
                                icon={<EditOutlined />}
                                aria-label={`编辑 ${p.name}`}
                                onClick={() => setProviderForm({ ...p })}
                              />
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                aria-label={`删除 ${p.name}`}
                                disabled={providers.length <= 1}
                                onClick={() => deleteProvider(p.id)}
                              />
                            </div>
                          </FlexBetween>
                          {p.id === activeProviderId && (
                            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
                              {p.baseUrl}
                            </Typography.Paragraph>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {providerForm && (
                    <div
                      style={{
                        border: '1px solid rgba(22,119,255,0.3)',
                        borderRadius: 8,
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <Typography.Text strong>
                        {providerForm.id ? `编辑 ${providerForm.id}` : '新建提供商'}
                      </Typography.Text>
                      <Input
                        value={providerForm.name}
                        onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                        placeholder="名称（如 DeepSeek、MyRelay）"
                        aria-label="提供商名称"
                      />
                      <Input.Password
                        value={providerForm.apiKey}
                        onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })}
                        placeholder="API Key"
                        prefix={<LockOutlined />}
                        aria-label="提供商 API Key"
                      />
                      <Input
                        value={providerForm.baseUrl}
                        onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })}
                        placeholder={DEFAULT_BASE_URL}
                        prefix={<LinkOutlined />}
                        aria-label="提供商 Base URL"
                      />
                      <FlexBetween>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          任意 OpenAI 兼容端点
                        </Typography.Text>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Button size="small" onClick={() => setProviderForm(null)}>
                            取消
                          </Button>
                          <Button size="small" type="primary" onClick={saveProviderForm}>
                            保存提供商
                          </Button>
                        </div>
                      </FlexBetween>
                    </div>
                  )}

                  <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                      可用模型
                    </Typography.Text>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        { id: 'v4-flash', name: 'v4-flash', desc: '快速响应 · 适合日常问答' },
                        { id: 'v4-pro', name: 'v4-pro', desc: '深度推理 · 适合复杂任务' },
                      ].map((m) => (
                        <div
                          key={m.id}
                          style={{
                            border: '1px solid rgba(5,5,5,0.08)',
                            borderRadius: 8,
                            padding: '8px 12px',
                          }}
                        >
                          <FlexBetween>
                            <Typography.Text strong>{m.name}</Typography.Text>
                            {model === m.id && (
                              <Tag color="green" style={{ fontSize: 11, marginRight: 0 }}>
                                当前使用
                              </Tag>
                            )}
                          </FlexBetween>
                          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}>
                            {m.desc}
                          </Typography.Paragraph>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Button
                      onClick={handleTest}
                      disabled={testing || !active?.apiKey}
                      icon={testing ? <LoadingOutlined /> : <RobotOutlined />}
                    >
                      {testing ? '测试中…' : '测试连接'}
                    </Button>
                    {active && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        使用 {active.name}（{active.baseUrl}）
                      </Typography.Text>
                    )}
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
                </div>
              )}

              {provider === 'mineru' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                      MinerU Token
                    </Typography.Text>
                    <Input.Password
                      value={mineruToken}
                      onChange={(e) => setMineruToken(e.target.value)}
                      placeholder="粘贴 MinerU API Token"
                      prefix={<FileTextOutlined />}
                      aria-label="MinerU Token"
                    />
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                      用于 PDF 解析（论文入库 / 自动收录）。获取 Token：
                      <a href="https://mineru.net/apiManage/token" target="_blank" rel="noreferrer">
                        https://mineru.net/apiManage/token
                      </a>
                    </Typography.Paragraph>
                  </div>
                </div>
              )}
              {provider === 'sciverse' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                      Sciverse Token
                    </Typography.Text>
                    <Input.Password
                      value={sciverseToken}
                      onChange={(e) => setSciverseToken(e.target.value)}
                      placeholder="粘贴 Sciverse API Token"
                      prefix={<LinkOutlined />}
                      aria-label="Sciverse Token"
                    />
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                      用于 Sciverse 工作区（全球文献检索 / 全文精读 / 引用关系 / 收藏入库）。获取 Token：
                      <a href="https://sciverse.space/tokens" target="_blank" rel="noreferrer">
                        https://sciverse.space/tokens
                      </a>
                    </Typography.Paragraph>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function navItemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: 13,
    background: active ? 'rgba(22,119,255,0.1)' : 'transparent',
    color: active ? '#1677ff' : 'inherit',
    fontWeight: active ? 600 : 400,
  };
}

function FlexBetween({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      {children}
    </div>
  );
}
