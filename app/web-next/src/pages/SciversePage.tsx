import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Flex, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, ExportOutlined, LinkOutlined, LoadingOutlined } from '@ant-design/icons';
import { useChatContext } from '@/context/ChatContext';
import { api } from '@/api';
import type { SciverseFavorite } from '@/types';
import ChatPanel from '@/components/ChatPanel';
import SessionSidebar from '@/components/SessionSidebar';
import { getSettings, loadSettings, saveSettings, activeProvider } from '@/lib/settings';

const SCIVERSE_PAPER_ID = '__sciverse__';

export default function SciversePage() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const {
    loadSessions,
    createNewSession,
    deleteCurrentSession,
    switchSession,
    renameSession,
    activeSessionId,
    sessionList,
  } = useChatContext();

  const [settings, setSettings] = useState(getSettings);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);

  const sessionId = activeSessionId[SCIVERSE_PAPER_ID] ?? '';
  const sessions = sessionList[SCIVERSE_PAPER_ID] ?? [];

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  useEffect(() => {
    loadSessions(SCIVERSE_PAPER_ID).then((sid) => {
      if (!sid) createNewSession(SCIVERSE_PAPER_ID);
    });
  }, [loadSessions, createNewSession]);

  const statusQ = useQuery({ queryKey: ['sciverse-status'], queryFn: api.sciverseStatus });
  const favsQ = useQuery({ queryKey: ['sciverse-favorites'], queryFn: api.sciverseListFavorites });
  const favorites = favsQ.data?.items ?? [];

  const handleSettingsChange = useCallback((next: typeof settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleNewSession = useCallback(async () => {
    await createNewSession(SCIVERSE_PAPER_ID);
  }, [createNewSession]);

  const handleDeleteSession = useCallback(
    async (sid: string) => {
      await deleteCurrentSession(SCIVERSE_PAPER_ID);
    },
    [deleteCurrentSession],
  );

  const handleSessionSelect = useCallback(
    async (sid: string) => {
      await switchSession(SCIVERSE_PAPER_ID, sid);
    },
    [switchSession],
  );

  const handleRenameSession = useCallback(
    (sid: string, title: string) => {
      renameSession(SCIVERSE_PAPER_ID, sid, title);
    },
    [renameSession],
  );

  const handleRemoveFavorite = async (fav: SciverseFavorite) => {
    modal.confirm({
      title: '移除收藏？',
      content: `「${fav.title}」将从 Sciverse 收藏夹移除（不影响已转正式入库的论文）。`,
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await api.sciverseRemoveFavorite(fav.doc_id);
        qc.invalidateQueries({ queryKey: ['sciverse-favorites'] });
      },
    });
  };

  const handlePromote = async (fav: SciverseFavorite) => {
    setPromoting(fav.doc_id);
    try {
      const res = await api.sciversePromote(fav.doc_id, {
        title: fav.title,
        doi: fav.doi,
        year: fav.year,
      });
      if (res.status === 'duplicate') {
        message.info('该论文已在本库中');
      } else {
        message.success(`「${res.paper.title}」已正式入库`);
      }
      qc.invalidateQueries({ queryKey: ['sciverse-favorites'] });
      qc.invalidateQueries({ queryKey: ['papers'] });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '入库失败');
    } finally {
      setPromoting(null);
    }
  };

  const tokenOk = statusQ.data?.enabled && statusQ.data?.tokenConfigured;

  return (
    <Flex vertical style={{ height: '100vh' }}>
      <Flex align="center" justify="space-between" style={{ padding: '8px 16px', borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
        <Flex align="center" gap={12}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/papers')} aria-label="返回" />
          <Typography.Title level={5} style={{ margin: 0 }}>
            Sciverse 工作区
          </Typography.Title>
          <Tag color={tokenOk ? 'green' : 'orange'} style={{ fontSize: 11 }}>
            {statusQ.data?.enabled === false ? '未启用' : tokenOk ? '已连接' : '未配置 Token'}
          </Tag>
        </Flex>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {sessions.length} 个会话 · 全球文献检索 / 精读 / 引用 / 收藏入库
        </Typography.Text>
      </Flex>

      <Flex style={{ flex: 1, minHeight: 0 }}>
        {!leftCollapsed && (
          <SessionSidebar
            sessions={sessions}
            activeSessionId={sessionId}
            onSessionSelect={handleSessionSelect}
            onNewSession={handleNewSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            width={240}
          />
        )}
        <Button
          type="text"
          size="small"
          style={{ position: 'absolute', zIndex: 10, marginTop: 4, marginLeft: leftCollapsed ? 4 : 230, transition: 'margin-left 0.2s' }}
          onClick={() => setLeftCollapsed(!leftCollapsed)}
          title={leftCollapsed ? '展开会话列表' : '收起会话列表'}
        >
          {leftCollapsed ? '»' : '«'}
        </Button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <ChatPanel
            mode="sciverse"
            apiKey={activeProvider(settings).apiKey}
            model={settings.model}
            onModelChange={(m) => handleSettingsChange({ ...settings, model: m })}
            quoteTexts={[]}
            onQuoteRemove={() => {}}
            onQuotesClear={() => {}}
          />
        </div>

        {!rightCollapsed && (
          <div style={{ width: 300, borderLeft: '1px solid rgba(5,5,5,0.06)', display: 'flex', flexDirection: 'column' }}>
            <Flex align="center" justify="space-between" style={{ padding: '8px 12px', borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                已收藏论文
              </Typography.Text>
              <Button type="text" size="small" onClick={() => setRightCollapsed(true)} title="收起收藏面板">
                »
              </Button>
            </Flex>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
              {favsQ.isLoading ? (
                <Flex align="center" justify="center" style={{ paddingTop: 32 }}>
                  <LoadingOutlined />
                </Flex>
              ) : favorites.length === 0 ? (
                <Flex vertical align="center" style={{ paddingTop: 40, color: 'rgba(0,0,0,0.45)' }} gap={8}>
                  <LinkOutlined style={{ fontSize: 20 }} />
                  <Typography.Text type="secondary" style={{ fontSize: 12, textAlign: 'center', padding: '0 12px' }}>
                    对话中让 AI 检索文献后，点工具结果里的收藏按钮即可加入这里
                  </Typography.Text>
                </Flex>
              ) : (
                <Flex vertical gap={8}>
                  {favorites.map((fav) => (
                    <div key={fav.doc_id} style={{ border: '1px solid rgba(5,5,5,0.08)', borderRadius: 8, padding: 10 }}>
                      <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: fav.title }}>
                        {fav.title}
                      </Typography.Text>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        {fav.year && <Tag style={{ fontSize: 11, marginRight: 0 }}>{fav.year}</Tag>}
                        {fav.venue && (
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            {fav.venue}
                          </Typography.Text>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                        <Button
                          size="small"
                          type="primary"
                          icon={<ExportOutlined />}
                          loading={promoting === fav.doc_id}
                          onClick={() => void handlePromote(fav)}
                        >
                          转正式
                        </Button>
                        <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => void handleRemoveFavorite(fav)} title="移除收藏" />
                      </div>
                    </div>
                  ))}
                </Flex>
              )}
            </div>
            <div style={{ padding: 8, borderTop: '1px solid rgba(5,5,5,0.06)' }}>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                收藏夹只存元数据，全文留在 Sciverse · 共 {favorites.length} 篇
              </Typography.Text>
            </div>
          </div>
        )}
        {rightCollapsed && (
          <Button
            type="text"
            size="small"
            style={{ alignSelf: 'flex-start', marginTop: 4 }}
            onClick={() => setRightCollapsed(false)}
            title="展开收藏面板"
          >
            «
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
