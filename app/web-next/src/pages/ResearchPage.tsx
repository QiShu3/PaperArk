import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Flex, Form, Input, Modal, Select, Skeleton, Space, Switch, Tag, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  LoadingOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import type {
  ResearchDirection,
  ResearchPaperStatus,
  ResearchQuery,
  ResearchRunDirection,
  ClassifyStatus,
} from '../types';
import { useDirection, GLOBAL_DIRECTION } from '../context/DirectionContext';

const SOURCE_LABELS: Record<string, string> = {
  arxiv: 'arXiv',
  semantic: 'Semantic Scholar',
  openalex: 'OpenAlex',
  iacr: 'IACR',
  zenodo: 'Zenodo',
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

const STATUS_LABEL: Record<ResearchPaperStatus, string> = {
  added: '已入库',
  duplicate: '已存在',
  download_failed: '下载失败',
  parse_failed: '解析失败',
  previously_failed: '曾失败',
};

const STATUS_COLOR: Record<ResearchPaperStatus, string> = {
  added: 'green',
  duplicate: 'default',
  download_failed: 'red',
  parse_failed: 'red',
  previously_failed: 'default',
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function directionCounts(dir: ResearchRunDirection): Record<ResearchPaperStatus, number> {
  const counts: Record<ResearchPaperStatus, number> = {
    added: 0,
    duplicate: 0,
    download_failed: 0,
    parse_failed: 0,
    previously_failed: 0,
  };
  for (const p of dir.papers) counts[p.status] += 1;
  return counts;
}

export default function ResearchPage() {
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const { direction, setDirection } = useDirection();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ResearchDirection | null>(null);
  const [name, setName] = useState('');
  const [queries, setQueries] = useState<ResearchQuery[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [maxPerRun, setMaxPerRun] = useState('');

  const cfgQ = useQuery({ queryKey: ['research-config'], queryFn: api.getResearchConfig });
  const statusQ = useQuery({
    queryKey: ['research-status'],
    queryFn: api.getResearchStatus,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
  });
  const runsQ = useQuery({ queryKey: ['research-runs'], queryFn: api.getResearchRuns });
  const classifyQ = useQuery({
    queryKey: ['research-classify'],
    queryFn: api.getClassifyStatus,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : false),
  });

  const availableSources = cfgQ.data?.availableSources ?? [];

  const openCreate = () => {
    setEditing(null);
    setName('');
    setQueries([{ source: 'arxiv', query: '' }]);
    setEnabled(true);
    setMaxPerRun('');
    setDialogOpen(true);
  };

  const openEdit = (d: ResearchDirection) => {
    setEditing(d);
    setName(d.name);
    setQueries(d.queries.map((q) => ({ source: q.source, query: q.query })));
    setEnabled(d.enabled);
    setMaxPerRun(d.maxPerRun?.toString() ?? '');
    setDialogOpen(true);
  };

  const updateQuery = (index: number, patch: Partial<ResearchQuery>) => {
    setQueries((cur) => cur.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const removeQuery = (index: number) => {
    setQueries((cur) => cur.filter((_, i) => i !== index));
  };

  const addQuery = () => {
    const used = new Set(queries.map((q) => q.source));
    const firstFree = availableSources.find((s) => !used.has(s.source))?.source ?? 'arxiv';
    setQueries((cur) => [...cur, { source: firstFree, query: '' }]);
  };

  const saveMut = useMutation({
    mutationFn: (d: { name: string; queries: ResearchQuery[]; enabled: boolean; maxPerRun?: number }) =>
      editing
        ? api.updateResearchDirection(editing.name, {
            queries: d.queries,
            enabled: d.enabled,
            maxPerRun: d.maxPerRun,
          })
        : api.createResearchDirection(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-config'] });
      setDialogOpen(false);
      message.success(editing ? '研究方向已更新' : '研究方向已添加');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '保存失败'),
  });

  const toggleMut = useMutation({
    mutationFn: (d: ResearchDirection) => api.updateResearchDirection(d.name, { enabled: !d.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-config'] }),
    onError: (e) => message.error(e instanceof Error ? e.message : '操作失败'),
  });

  const deleteMut = useMutation({
    mutationFn: (directionName: string) => api.deleteResearchDirection(directionName),
    onSuccess: (_data, directionName) => {
      qc.invalidateQueries({ queryKey: ['research-config'] });
      if (directionName === direction) setDirection(GLOBAL_DIRECTION);
      message.success('研究方向已删除');
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '删除失败'),
  });

  const checkMut = useMutation({
    mutationFn: api.checkResearch,
    onSuccess: () => {
      message.success('已开始自动检查，完成后可查看运行历史');
      qc.invalidateQueries({ queryKey: ['research-status'] });
      qc.invalidateQueries({ queryKey: ['research-runs'] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '启动检查失败'),
  });

  const classifyMut = useMutation({
    mutationFn: api.startClassify,
    onSuccess: () => {
      message.success('已开始对已有论文进行分类');
      qc.invalidateQueries({ queryKey: ['research-classify'] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '启动分类失败'),
  });

  const submit = () => {
    const trimmedName = name.trim();
    const validQueries = queries
      .map((q) => ({ source: q.source, query: q.query.trim() }))
      .filter((q) => q.query.length > 0);
    if (!trimmedName || validQueries.length === 0) {
      message.error('名称和查询词不能为空');
      return;
    }
    saveMut.mutate({
      name: trimmedName,
      queries: validQueries,
      enabled,
      maxPerRun: maxPerRun.trim() ? Number(maxPerRun) : undefined,
    });
  };

  const handleDeleteConfirm = (d: ResearchDirection) => {
    modal.confirm({
      title: `删除研究方向「${d.name}」？`,
      content: '已收录的论文不会被删除。',
      okText: '确定',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMut.mutate(d.name),
    });
  };

  const running = statusQ.data?.running ?? false;
  const classifyStatus: ClassifyStatus | undefined = classifyQ.data;
  const classifying = classifyStatus?.running ?? false;

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
        <Flex align="center" justify="space-between" gap={16} wrap>
          <Flex align="center" gap={12}>
            <Button type="text" icon={<ArrowLeftOutlined />}>
              <Link to="/papers" aria-label="返回论文列表" style={{ color: 'inherit' }} />
            </Button>
            <div>
              <Typography.Title level={3} style={{ margin: 0 }}>
                研究方向 · 自动收录
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {cfgQ.data
                  ? `定时 ${cfgQ.data.schedule.cron} (${cfgQ.data.schedule.timezone}) · 单方向上限 ${cfgQ.data.maxPerRun} 篇`
                  : '加载中…'}
              </Typography.Text>
            </div>
          </Flex>
          <Space>
            <Flex align="center" gap={6}>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                当前方向
              </Typography.Text>
              <Select
                value={direction}
                onChange={(v) => setDirection(v)}
                style={{ width: 220 }}
                aria-label="当前研究方向"
                options={[
                  { value: GLOBAL_DIRECTION, label: '全局' },
                  ...(cfgQ.data?.directions.map((d) => ({ value: d.name, label: d.name })) ?? []),
                ]}
              />
            </Flex>
            <Button
              icon={checkMut.isPending ? <LoadingOutlined /> : <ReloadOutlined />}
              onClick={() => checkMut.mutate()}
              disabled={running || checkMut.isPending}
            >
              立即检查
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增方向
            </Button>
          </Space>
        </Flex>

        {running && (
          <Card style={{ marginTop: 16 }}>
            <Flex align="center" gap={8}>
              <LoadingOutlined />
              自动检查进行中，正在抓取 arXiv 并解析论文…
            </Flex>
          </Card>
        )}

        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cfgQ.isLoading &&
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} active paragraph={{ rows: 2 }} />)}
          {!cfgQ.isLoading && (cfgQ.data?.directions.length ?? 0) === 0 && (
            <Typography.Text type="secondary" style={{ textAlign: 'center', padding: '32px 0', display: 'block' }}>
              还没有研究方向，点击右上角「新增方向」开始订阅
            </Typography.Text>
          )}
          {cfgQ.data?.directions.map((d) => (
            <Card key={d.name} size="small">
              <Flex justify="space-between" gap={16}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Flex gap={8} wrap align="center">
                    <Typography.Text strong>{d.name}</Typography.Text>
                    <Tag color={d.enabled ? 'green' : 'default'} style={{ fontSize: 11, marginRight: 0 }}>
                      {d.enabled ? '启用' : '停用'}
                    </Tag>
                    {d.maxPerRun !== undefined && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        上限 {d.maxPerRun} 篇/次
                      </Typography.Text>
                    )}
                  </Flex>
                  {d.queries.map((q) => (
                    <div key={q.source} style={{ marginTop: 4 }}>
                      <Tag color="blue" style={{ fontSize: 11, marginRight: 4 }}>
                        {sourceLabel(q.source)}
                      </Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {q.query}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
                <Space>
                  <Button size="small" onClick={() => toggleMut.mutate(d)} loading={toggleMut.isPending}>
                    {d.enabled ? '停用' : '启用'}
                  </Button>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(d)} aria-label="编辑" />
                  <Button size="small" danger onClick={() => handleDeleteConfirm(d)} aria-label="删除">
                    删除
                  </Button>
                </Space>
              </Flex>
            </Card>
          ))}
        </div>

        <Card style={{ marginTop: 24 }}>
          <Flex justify="space-between" align="center" gap={16} wrap>
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}>
                已有论文分类
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                由 AI 根据标题和摘要判断每篇论文所属的研究方向，已分类的论文会跳过。
              </Typography.Text>
              {classifying && classifyStatus && (
                <Typography.Text style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                  进度 {classifyStatus.current}/{classifyStatus.total} · 命中 {classifyStatus.matched} · 失败 {classifyStatus.failed}
                </Typography.Text>
              )}
            </div>
            <Button
              icon={classifying || classifyMut.isPending ? <LoadingOutlined /> : <ThunderboltOutlined />}
              onClick={() => classifyMut.mutate()}
              disabled={classifying || classifyMut.isPending}
            >
              {classifying ? '分类中…' : '分类已有论文'}
            </Button>
          </Flex>
          {!classifying && (classifyStatus?.failed ?? 0) > 0 && (
            <ul style={{ marginTop: 12, paddingLeft: 20 }}>
              {classifyStatus!.errors.map((err) => (
                <li key={err}>
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    {err}
                  </Typography.Text>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div style={{ marginTop: 24 }}>
          <Typography.Title level={5}>运行历史</Typography.Title>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {runsQ.isLoading && <Typography.Text type="secondary">加载中…</Typography.Text>}
            {!runsQ.isLoading && (runsQ.data?.length ?? 0) === 0 && (
              <Typography.Text type="secondary">还没有运行记录，点击「立即检查」开始第一次抓取。</Typography.Text>
            )}
            {runsQ.data?.map((run) => (
              <Card key={run.runId} size="small">
                <Flex gap={8} wrap align="center" style={{ marginBottom: 8 }}>
                  <Tag color={run.status === 'running' ? 'processing' : 'default'}>
                    {run.status === 'running' ? '运行中' : '完成'}
                  </Tag>
                  <Typography.Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
                    {run.runId.slice(0, 8)}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {formatTime(run.startedAt)}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    共 {run.directions.length} 个方向
                  </Typography.Text>
                </Flex>
                {run.directions.map((dir) => {
                  const counts = directionCounts(dir);
                  return (
                    <details key={dir.direction} style={{ marginTop: 4 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                        {dir.direction}
                        <span style={{ marginLeft: 8, display: 'inline-flex', gap: 6 }}>
                          {counts.added > 0 && <Tag color="green" style={{ fontSize: 11, marginRight: 0 }}>{counts.added} 新增</Tag>}
                          {counts.duplicate > 0 && <Tag style={{ fontSize: 11, marginRight: 0 }}>{counts.duplicate} 已存在</Tag>}
                          {counts.download_failed + counts.parse_failed > 0 && (
                            <Tag color="red" style={{ fontSize: 11, marginRight: 0 }}>
                              {counts.download_failed + counts.parse_failed} 失败
                            </Tag>
                          )}
                          {counts.previously_failed > 0 && <Tag style={{ fontSize: 11, marginRight: 0 }}>{counts.previously_failed} 曾失败</Tag>}
                          {dir.error && <Tag color="red" style={{ fontSize: 11, marginRight: 0 }}>查询失败</Tag>}
                        </span>
                      </summary>
                      <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                        {dir.papers.map((p) => (
                          <li key={p.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                            <Tag color={STATUS_COLOR[p.status]} style={{ fontSize: 11, marginRight: 0 }}>
                              {STATUS_LABEL[p.status]}
                            </Tag>
                            <Tag style={{ fontSize: 11, marginRight: 0 }}>{sourceLabel(p.source)}</Tag>
                            <Typography.Text style={{ fontSize: 12 }}>{p.title}</Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                              {p.arxivId}
                            </Typography.Text>
                            {p.error && (
                              <Typography.Text type="danger" style={{ fontSize: 12 }}>
                                — {p.error}
                              </Typography.Text>
                            )}
                          </li>
                        ))}
                        {dir.error && (
                          <li>
                            <Typography.Text type="danger" style={{ fontSize: 12 }}>
                              方向查询失败: {dir.error}
                            </Typography.Text>
                          </li>
                        )}
                      </ul>
                    </details>
                  );
                })}
              </Card>
            ))}
          </div>
        </div>
      </div>

      <Modal
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        title={editing ? '编辑研究方向' : '新增研究方向'}
        okText="保存"
        cancelText="取消"
        onOk={submit}
        confirmLoading={saveMut.isPending}
        destroyOnHidden
      >
        <Form layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="名称" htmlFor="direction-name">
            <Input
              id="direction-name"
              value={name}
              disabled={!!editing}
              placeholder="如：基于扩散模型的对抗攻击"
              onChange={(e) => setName(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="查询条目（每个源独立查询词）">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {queries.map((q, index) => (
                <Flex key={index} gap={8} align="flex-start">
                  <Select
                    value={q.source}
                    onChange={(v) => updateQuery(index, { source: v })}
                    style={{ width: 180, flexShrink: 0 }}
                    options={availableSources.map((s) => ({ value: s.source, label: s.label }))}
                    aria-label={`第 ${index + 1} 个查询的源`}
                  />
                  <Input.TextArea
                    value={q.query}
                    onChange={(e) => updateQuery(index, { query: e.target.value })}
                    autoSize={{ minRows: 1 }}
                    placeholder={
                      q.source === 'arxiv'
                        ? 'abs:"diffusion model" AND abs:adversarial AND abs:attack'
                        : 'diffusion model adversarial attack'
                    }
                  />
                  <Button
                    icon={<MinusOutlined />}
                    disabled={queries.length <= 1}
                    onClick={() => removeQuery(index)}
                    aria-label="删除该查询条目"
                  />
                </Flex>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={addQuery} block>
                添加来源
              </Button>
            </div>
          </Form.Item>
          <Form.Item label="单次最多收录（留空用全局默认）" htmlFor="direction-max">
            <Input
              id="direction-max"
              type="number"
              min={1}
              value={maxPerRun}
              placeholder="5"
              onChange={(e) => setMaxPerRun(e.target.value)}
            />
          </Form.Item>
          <Form.Item label=" ">
            <Flex align="center" gap={8}>
              <Switch checked={enabled} onChange={setEnabled} />
              <Typography.Text>启用该方向</Typography.Text>
            </Flex>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
