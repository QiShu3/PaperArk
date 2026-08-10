import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Flex, Input, List, Skeleton, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useChatContext } from '@/context/ChatContext';
import { api } from '@/api';
import type { Paper } from '@/types';
import ChatPanel from '@/components/ChatPanel';
import SessionSidebar from '@/components/SessionSidebar';
import { getSettings, loadSettings, saveSettings } from '@/lib/settings';
import { useQuery } from '@tanstack/react-query';

const GLOBAL_PAPER_ID = '__global__';

export default function GlobalChat() {
  const navigate = useNavigate();
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
  const [inputText, setInputText] = useState('');
  const [toolQuery, setToolQuery] = useState('');

  const sessionId = activeSessionId[GLOBAL_PAPER_ID] ?? '';
  const sessions = sessionList[GLOBAL_PAPER_ID] ?? [];

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  useEffect(() => {
    loadSessions(GLOBAL_PAPER_ID).then((sid) => {
      if (!sid) {
        createNewSession(GLOBAL_PAPER_ID);
      }
    });
  }, [loadSessions, createNewSession]);

  const handleSettingsChange = useCallback((next: typeof settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleNewSession = useCallback(async () => {
    await createNewSession(GLOBAL_PAPER_ID);
  }, [createNewSession]);

  const handleDeleteSession = useCallback(
    async (sid: string) => {
      await deleteCurrentSession(GLOBAL_PAPER_ID);
    },
    [deleteCurrentSession],
  );

  const handleSessionSelect = useCallback(
    async (sid: string) => {
      await switchSession(GLOBAL_PAPER_ID, sid);
    },
    [switchSession],
  );

  const handleRenameSession = useCallback(
    (sid: string, title: string) => {
      renameSession(GLOBAL_PAPER_ID, sid, title);
    },
    [renameSession],
  );

  const handleInsertReference = useCallback((text: string) => {
    setInputText((prev) => prev + (prev ? '\n' : '') + text);
  }, []);

  const papersQ = useQuery({ queryKey: ['papers'], queryFn: api.listPapers });
  const searching = toolQuery.trim().length >= 2;
  const searchQ = useQuery({
    queryKey: ['search', toolQuery.trim()],
    queryFn: () => api.search(toolQuery.trim()),
    enabled: searching,
  });

  const papers: Paper[] = searching ? (searchQ.data ?? []) : (papersQ.data ?? []);
  const loading = papersQ.isLoading || (searching && searchQ.isLoading);

  const handleInsert = (paper: Paper) => {
    handleInsertReference(`[${paper.title}](${paper.id})`);
  };

  return (
    <Flex vertical style={{ height: '100vh' }}>
      <Flex align="center" justify="space-between" style={{ padding: '8px 16px', borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
        <Flex align="center" gap={12}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')} aria-label="返回" />
          <Typography.Title level={5} style={{ margin: 0 }}>
            全局对话
          </Typography.Title>
        </Flex>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {sessions.length} 个会话
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
            mode="global"
            apiKey={settings.apiKey}
            model={settings.model}
            onModelChange={(m) => handleSettingsChange({ ...settings, model: m })}
            quoteTexts={[]}
            onQuoteRemove={() => {}}
            onQuotesClear={() => {}}
            inputValue={inputText}
            onInputChange={setInputText}
          />
        </div>

        {!rightCollapsed && (
          <div style={{ width: 280, borderLeft: '1px solid rgba(5,5,5,0.06)', display: 'flex', flexDirection: 'column' }}>
            <Flex align="center" justify="space-between" style={{ padding: '8px 12px', borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                论文库
              </Typography.Text>
              <Button type="text" size="small" onClick={() => setRightCollapsed(true)} title="收起论文面板">
                »
              </Button>
            </Flex>
            <div style={{ padding: 8 }}>
              <Input
                prefix={<SearchOutlined />}
                placeholder="搜索论文…"
                value={toolQuery}
                onChange={(e) => setToolQuery(e.target.value)}
                allowClear
                size="small"
              />
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px 8px' }}>
              {loading ? (
                <Skeleton active paragraph={{ rows: 4 }} style={{ padding: 8 }} />
              ) : papers.length === 0 ? (
                <Flex vertical align="center" style={{ paddingTop: 32, color: 'rgba(0,0,0,0.45)' }} gap={8}>
                  <FileTextOutlined style={{ fontSize: 20 }} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {searching ? '没有匹配的论文' : '暂无论文'}
                  </Typography.Text>
                </Flex>
              ) : (
                <List
                  size="small"
                  dataSource={papers}
                  renderItem={(paper) => (
                    <List.Item
                      onClick={() => handleInsert(paper)}
                      style={{ cursor: 'pointer', padding: '8px 12px', borderRadius: 6 }}
                    >
                      <div>
                        <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: paper.title }}>
                          {paper.title}
                        </Typography.Text>
                        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                          <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                            {paper.id}
                          </Typography.Text>
                          {paper.venue && (
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                              {paper.venue}
                            </Typography.Text>
                          )}
                          {paper.year && (
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                              {paper.year}
                            </Typography.Text>
                          )}
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </div>
            <div style={{ padding: 8, borderTop: '1px solid rgba(5,5,5,0.06)' }}>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                点击论文插入引用 · {papers.length} 篇
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
            title="展开论文面板"
          >
            «
          </Button>
        )}
      </Flex>

    </Flex>
  );
}
