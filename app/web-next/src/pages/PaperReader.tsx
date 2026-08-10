import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Flex, Input, Skeleton, Segmented, Space, Splitter, Tag, theme, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  CalendarOutlined,
  DownOutlined,
  EditOutlined,
  FileTextOutlined,
  FireOutlined,
  HomeOutlined,
  LinkOutlined,
  SaveOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import { useChatContext } from '../context/ChatContext';
import MdEditor from '../components/MdEditor';
import PdfViewer from '../components/PdfViewer';
import ChunkView from '../components/ChunkView';
import TagEditor from '../components/TagEditor';
import MdTranslationView from '../components/MdTranslationView';
import ChatPanel from '../components/ChatPanel';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { getSettings, loadSettings, saveSettings } from '../lib/settings';
import type { Settings as SettingsType } from '../types';

export default function PaperReader() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();

  const { loadSessions, createNewSession } = useChatContext();

  const paperQ = useQuery({ queryKey: ['paper', id], queryFn: () => api.getPaper(id) });
  const paper = paperQ.data;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [contentTab, setContentTab] = useState<'md' | 'pdf' | 'chunk'>('md');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsType>(getSettings);
  const [quoteTexts, setQuoteTexts] = useState<string[]>([]);
  const [chunkContent, setChunkContent] = useState('');
  const [chunkHeading, setChunkHeading] = useState('');
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDraft, setMetaDraft] = useState<{ venue?: string; year?: string; area?: string }>({});
  const [swapped, setSwapped] = useState(false);
  const [splitSizes, setSplitSizes] = useState<[number, number]>([50, 50]);
  const [swapHover, setSwapHover] = useState(false);
  const { token } = theme.useToken();

  const toggleSwap = () => {
    setSwapped((s) => !s);
    setSplitSizes(([a, b]) => [b, a]);
  };

  const startEditMeta = () => {
    setMetaDraft({ venue: paper?.venue, year: paper?.year, area: paper?.area });
    setEditingMeta(true);
  };

  const saveMeta = async () => {
    if (!paper) return;
    try {
      await api.updatePaper(id, metaDraft);
      invalidate();
      setEditingMeta(false);
      message.success('已保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    loadSessions(id).then((sid) => {
      if (!sid) createNewSession(id);
    });
  }, [id, loadSessions, createNewSession]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['paper', id] });
    qc.invalidateQueries({ queryKey: ['papers'] });
    qc.invalidateQueries({ queryKey: ['tags'] });
  };

  const startEdit = () => {
    setDraft(paper?.markdown ?? '');
    setEditing(true);
  };

  const saveMut = useMutation({
    mutationFn: () => api.updatePaper(id, { markdown: draft }),
    onSuccess: () => {
      message.success('已保存');
      setEditing(false);
      invalidate();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : '保存失败'),
  });

  const saveTags = (next: string[]) => {
    api
      .updatePaper(id, { tags: next })
      .then(() => invalidate())
      .catch((e) => message.error(e instanceof Error ? e.message : '标签保存失败'));
  };

  const handleDelete = () => {
    modal.confirm({
      title: '删除这篇论文？',
      content: '将同时删除对应的 PDF、Markdown 以及不再被引用的图片。此操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.deletePaper(id);
          message.success('已删除');
          qc.invalidateQueries({ queryKey: ['papers'] });
          qc.invalidateQueries({ queryKey: ['tags'] });
          navigate('/');
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
        }
      },
    });
  };

  const handleSettingsChange = (s: SettingsType) => {
    setSettings(s);
    saveSettings(s);
  };

  if (paperQ.isLoading) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 16px' }}>
        <Skeleton active paragraph={{ rows: 1 }} style={{ width: '50%' }} />
        <Skeleton active paragraph={{ rows: 12 }} style={{ marginTop: 24 }} />
      </div>
    );
  }

  if (paperQ.error || !paper) {
    return (
      <Flex vertical align="center" style={{ padding: '64px 16px' }} gap={16}>
        <Typography.Text type="danger">
          {paperQ.error instanceof Error ? paperQ.error.message : '论文不存在'}
        </Typography.Text>
        <Button onClick={() => navigate('/')}>
          <ArrowLeftOutlined /> 返回列表
        </Button>
      </Flex>
    );
  }

  const contentPanel = (
    <div
      style={{
        height: '100%',
        minWidth: 0,
        overflowY: 'auto',
        padding: 20,
        ...(swapped
          ? { borderLeft: '1px solid rgba(5,5,5,0.06)' }
          : { borderRight: '1px solid rgba(5,5,5,0.06)' }),
      }}
    >
      {contentTab === 'chunk' ? (
        <ChunkView
          paperId={paper.id}
          onActiveChunkChange={(heading, content) => {
            setChunkHeading(heading);
            setChunkContent(content);
          }}
        />
      ) : contentTab === 'md' ? (
        <MdTranslationView
          paperId={paper.id}
          markdown={paper.markdown}
          onTextSelect={(text) => setQuoteTexts((prev) => [...prev, text])}
        />
      ) : paper.hasPdf ? (
        <PdfViewer url={`/rawPDF/${paper.id}.pdf`} title={paper.title} />
      ) : (
        <Flex align="center" justify="center" style={{ height: '100%' }}>
          <Typography.Text type="secondary">无 PDF 文件</Typography.Text>
        </Flex>
      )}
    </div>
  );

  const chatPanel = (
    <div style={{ height: '100%', minWidth: 0, minHeight: 0 }}>
      <ErrorBoundary>
        <ChatPanel
          paperId={paper.id}
          paperTitle={paper.title}
          paperContent={contentTab === 'chunk' ? chunkContent : paper.markdown}
          apiKey={settings.apiKey}
          model={settings.model}
          onModelChange={(m) => handleSettingsChange({ ...settings, model: m })}
          quoteTexts={quoteTexts}
          onQuoteRemove={(i) => setQuoteTexts((prev) => prev.filter((_, j) => j !== i))}
          onQuotesClear={() => setQuoteTexts([])}
          contentMode={contentTab === 'chunk' ? 'chunk' : 'full'}
          chunkHeading={chunkHeading}
        />
      </ErrorBoundary>
    </div>
  );

  return (
    <Flex vertical style={{ height: '100vh' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
        <Flex align="center" justify="space-between" gap={16}>
          <Flex align="center" gap={8} style={{ flex: 1, minWidth: 0 }}>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} aria-label="返回" />
            <Typography.Title level={5} style={{ margin: 0 }} ellipsis>
              {paper.title}
            </Typography.Title>
          </Flex>

          <Space>
            <Button
              type="text"
              icon={detailsOpen ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setDetailsOpen((v) => !v)}
              title={detailsOpen ? '折叠详细信息' : '展开详细信息'}
            />
            {editing ? (
              <>
                <Button onClick={() => setEditing(false)}>取消</Button>
                <Button type="primary" onClick={() => saveMut.mutate()} loading={saveMut.isPending} icon={<SaveOutlined />}>
                  保存
                </Button>
              </>
            ) : (
              <>
                <Button icon={<EditOutlined />} onClick={startEdit}>
                  编辑
                </Button>
                <Button danger onClick={handleDelete}>
                  删除
                </Button>
              </>
            )}
          </Space>
        </Flex>

        {(detailsOpen || editingMeta) && (
          <div style={{ paddingLeft: 40 }}>
            <Flex gap={12} wrap align="center" style={{ marginTop: 12 }}>
              <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                {paper.id}
              </Typography.Text>
              <a href={`https://arxiv.org/abs/${paper.id}`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                <LinkOutlined /> arXiv
              </a>
              {paper.hasPdf && (
                <a href={`/rawPDF/${paper.id}.pdf`} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                  <FileTextOutlined /> 新窗口打开 PDF
                </a>
              )}
            </Flex>

            {(paper.venue || paper.year || paper.area || paper.source === 'arxiv-auto') && !editingMeta && (
              <Flex gap={6} wrap align="center" style={{ marginTop: 6 }}>
                {paper.source === 'arxiv-auto' && (
                  <Tag icon={<ThunderboltOutlined />} color="gold" style={{ fontSize: 11, marginRight: 0 }}>
                    自动收录
                  </Tag>
                )}
                {paper.venue && (
                  <Tag icon={<HomeOutlined />} style={{ fontSize: 11, marginRight: 0 }}>
                    {paper.venue}
                  </Tag>
                )}
                {paper.year && (
                  <Tag icon={<CalendarOutlined />} style={{ fontSize: 11, marginRight: 0 }}>
                    {paper.year}
                  </Tag>
                )}
                {paper.area && (
                  <Tag icon={<FireOutlined />} style={{ fontSize: 11, marginRight: 0 }}>
                    {paper.area}
                  </Tag>
                )}
                <Button type="text" size="small" icon={<EditOutlined />} onClick={startEditMeta} title="编辑发表信息" />
              </Flex>
            )}

            {editingMeta && (
              <Flex gap={8} align="center" style={{ marginTop: 6 }}>
                <Input size="small" style={{ width: 140 }} placeholder="会议/期刊" value={metaDraft.venue ?? ''} onChange={(e) => setMetaDraft((d) => ({ ...d, venue: e.target.value }))} />
                <Input size="small" style={{ width: 90 }} placeholder="年份" value={metaDraft.year ?? ''} onChange={(e) => setMetaDraft((d) => ({ ...d, year: e.target.value }))} />
                <Input size="small" style={{ width: 120 }} placeholder="研究方向" value={metaDraft.area ?? ''} onChange={(e) => setMetaDraft((d) => ({ ...d, area: e.target.value }))} />
                <Button type="text" size="small" icon={<SaveOutlined />} onClick={() => void saveMeta()} />
                <Button type="text" size="small" onClick={() => setEditingMeta(false)}>
                  取消
                </Button>
              </Flex>
            )}

            {(paper.venue || paper.year || paper.area) ? null : !editingMeta && (
              <Button type="link" size="small" style={{ padding: 0, marginTop: 6 }} onClick={startEditMeta}>
                <EditOutlined /> 添加发表信息
              </Button>
            )}

            <Flex align="center" gap={16} style={{ marginTop: 12 }}>
              <TagEditor tags={paper.tags} onChange={saveTags} />
              {paper.hasMd && !editing && (
                <Segmented
                  value={contentTab}
                  onChange={(v) => setContentTab(v as 'md' | 'pdf' | 'chunk')}
                  options={[
                    { label: 'Markdown', value: 'md' },
                    ...(paper.hasPdf ? [{ label: 'PDF', value: 'pdf' as const }] : []),
                    { label: '分块', value: 'chunk' },
                  ]}
                />
              )}
            </Flex>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {editing ? (
          <div style={{ height: '100%', padding: 12 }}>
            <MdEditor value={draft} onChange={setDraft} />
          </div>
        ) : (
          <Splitter
            style={{ height: '100%' }}
            onResize={(sizes) => setSplitSizes([sizes[0], sizes[1]])}
            draggerIcon={
              <div
                title="交换左右位置"
                role="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={toggleSwap}
                onMouseEnter={() => setSwapHover(true)}
                onMouseLeave={() => setSwapHover(false)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  background: swapHover ? token.colorPrimary : token.colorBgContainer,
                  color: swapHover ? '#fff' : token.colorTextSecondary,
                  border: `1px solid ${swapHover ? 'transparent' : token.colorBorderSecondary}`,
                  boxShadow: token.boxShadowTertiary,
                  transition: 'all 0.2s',
                  fontSize: 14,
                }}
              >
                <SwapOutlined />
              </div>
            }
            styles={{
              dragger: { default: { width: 34, height: '100%', background: 'transparent' } },
            }}
          >
            <Splitter.Panel size={splitSizes[0]} min="25%">
              {swapped ? chatPanel : contentPanel}
            </Splitter.Panel>
            <Splitter.Panel size={splitSizes[1]} min="25%">
              {swapped ? contentPanel : chatPanel}
            </Splitter.Panel>
          </Splitter>
        )}
      </div>

    </Flex>
  );
}
