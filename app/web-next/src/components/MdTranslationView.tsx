import { useCallback, useEffect, useState } from 'react';
import { App, Button, Flex, Progress, Segmented, Typography } from 'antd';
import { CloseOutlined, LoadingOutlined, ReloadOutlined, TranslationOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { MdTranslationRecord } from '../types';
import MarkdownView from './MarkdownView';

interface Props {
  paperId: string;
  markdown: string;
  onTextSelect?: (text: string) => void;
}

export default function MdTranslationView({ paperId, markdown, onTextSelect }: Props) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<'orig' | 'zh'>('orig');
  const [record, setRecord] = useState<MdTranslationRecord | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRecord(await api.getMdTranslateStatus(paperId));
    } catch {
      // 轮询失败时静默等待下一次
    }
  }, [paperId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = record?.status === 'running';

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const start = async () => {
    setStarting(true);
    try {
      setRecord(await api.startMdTranslate(paperId));
    } catch (e) {
      message.error(e instanceof Error ? e.message : '启动翻译失败');
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      setRecord(await api.cancelMdTranslate(paperId));
    } catch (e) {
      message.error(e instanceof Error ? e.message : '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  const zhDone = mode === 'zh' && record?.status === 'done';
  const failed = record?.status === 'failed' || record?.status === 'cancelled';

  return (
    <Flex vertical style={{ height: '100%' }}>
      <Flex align="center" gap={12} wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as 'orig' | 'zh')}
          options={[
            { label: '原文', value: 'orig' },
            { label: '中文', value: 'zh' },
          ]}
        />

        {mode === 'zh' && record?.status === 'idle' && (
          <Button size="small" onClick={start} disabled={starting} icon={starting ? <LoadingOutlined /> : <TranslationOutlined />}>
            翻译为中文
          </Button>
        )}

        {mode === 'zh' && running && (
          <Flex align="center" gap={8}>
            <LoadingOutlined style={{ color: '#1677ff' }} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              翻译中 {record.progress?.done ?? 0}/{record.progress?.total ?? '-'}
            </Typography.Text>
            <Button size="small" type="text" onClick={cancel} disabled={cancelling} icon={cancelling ? <LoadingOutlined /> : <CloseOutlined />}>
              取消
            </Button>
            {record.progress && record.progress.total > 0 && (
              <Progress percent={Math.round((record.progress.done / record.progress.total) * 100)} size="small" style={{ width: 160 }} />
            )}
          </Flex>
        )}

        {mode === 'zh' && failed && (
          <Flex align="center" gap={8}>
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {record?.status === 'cancelled' ? '翻译已取消' : record?.error || '翻译失败'}
            </Typography.Text>
            <Button size="small" type="text" onClick={start} disabled={starting} icon={starting ? <LoadingOutlined /> : <ReloadOutlined />}>
              重试
            </Button>
          </Flex>
        )}
      </Flex>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <MarkdownView content={zhDone ? (record?.content ?? '') : markdown} onTextSelect={onTextSelect} />
      </div>
    </Flex>
  );
}
