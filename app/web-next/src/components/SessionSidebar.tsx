import { App, Button } from 'antd';
import { Conversations, type ConversationsProps } from '@ant-design/x';
import {
  MessageOutlined,
  PlusOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { ChatSession } from '@/types';

interface SessionSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  isStreaming?: boolean;
  width?: number;
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onSessionSelect,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  isStreaming = false,
  width = 240,
}: SessionSidebarProps) {
  const { modal } = App.useApp();

  const items = sessions.map((s) => ({
    key: s.id,
    label: s.title || '未命名会话',
    icon: <MessageOutlined />,
  }));

  const menu: ConversationsProps['menu'] = (item) => {
    const key = String(item.key);
    return {
      items: [
        { key: 'rename', icon: <SettingOutlined />, label: '重命名' },
        { key: 'delete', danger: true, icon: <SettingOutlined />, label: '删除' },
      ],
      onClick: (info) => {
        if (info.key === 'delete') {
          modal.confirm({
            title: '删除会话？',
            content: '该会话的所有消息将被永久删除。',
            okText: '删除',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () => onDeleteSession(key),
          });
        } else if (info.key === 'rename') {
          let title = '';
          modal.confirm({
            title: '重命名会话',
            content: (
              <input
                autoFocus
                placeholder="输入新名称"
                defaultValue={sessions.find((s) => s.id === key)?.title ?? ''}
                onChange={(e) => {
                  title = e.target.value;
                }}
                style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #d9d9d9' }}
              />
            ),
            onOk: () => {
              const t = title.trim();
              if (t) onRenameSession(key, t);
            },
          });
        }
      },
    };
  };

  return (
    <div style={{ width, height: '100%', display: 'flex', flexDirection: 'column', borderRight: '1px solid rgba(5,5,5,0.06)' }}>
      <div style={{ padding: 12 }}>
        <Button
          type="primary"
          block
          icon={<PlusOutlined />}
          onClick={onNewSession}
          disabled={isStreaming}
        >
          新建会话
        </Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px' }}>
        <Conversations
          items={items}
          activeKey={activeSessionId}
          onActiveChange={(key) => onSessionSelect(String(key))}
          menu={menu}
        />
      </div>
    </div>
  );
}
