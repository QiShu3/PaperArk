import { useNavigate } from 'react-router-dom';
import { Button, Descriptions, Drawer, Flex, Tag, Typography } from 'antd';
import {
  FilePdfOutlined,
  LinkOutlined,
  MessageOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import type { Paper } from '../types';
import { formatDate, sourceLabel } from '../lib/paperMeta';

interface Props {
  paper: Paper | null;
  onClose: () => void;
}

export default function PaperPreviewDrawer({ paper, onClose }: Props) {
  const navigate = useNavigate();

  const items: { key: string; label: string; children: React.ReactNode }[] = [];
  if (paper) {
    if (paper.authors && paper.authors.length > 0) {
      items.push({ key: 'authors', label: '作者', children: paper.authors.join(' · ') });
    }
    if (paper.year) items.push({ key: 'year', label: '年份', children: paper.year });
    if (paper.venue) items.push({ key: 'venue', label: '会议/期刊', children: paper.venue });
    if (paper.area) items.push({ key: 'area', label: '研究方向', children: paper.area });
    items.push({
      key: 'source',
      label: '来源',
      children: paper.source
        ? `${sourceLabel(paper.source)}${paper.sourceId ? ` · ${paper.sourceId}` : ''}`
        : '手动',
    });
    if (paper.doi) items.push({ key: 'doi', label: 'DOI', children: paper.doi });
    if (paper.addedAt) items.push({ key: 'addedAt', label: '收录时间', children: formatDate(paper.addedAt) });
    items.push({ key: 'id', label: 'ID', children: <Typography.Text code>{paper.id}</Typography.Text> });
    if (paper.directions && paper.directions.length > 0) {
      items.push({
        key: 'directions',
        label: '研究方向',
        children: (
          <Flex gap={4} wrap>
            {paper.directions.map((d) => (
              <Tag key={d} style={{ fontSize: 11, marginRight: 0 }}>
                {d}
              </Tag>
            ))}
          </Flex>
        ),
      });
    }
    if (paper.tags.length > 0) {
      items.push({
        key: 'tags',
        label: '标签',
        children: (
          <Flex gap={4} wrap>
            {paper.tags.map((t) => (
              <Tag key={t} color="blue" style={{ fontSize: 11, marginRight: 0 }}>
                {t}
              </Tag>
            ))}
          </Flex>
        ),
      });
    }
    if (paper.notes) items.push({ key: 'notes', label: '笔记', children: paper.notes });
  }

  return (
    <Drawer
      open={!!paper}
      onClose={onClose}
      size={420}
      title={paper?.title}
      destroyOnHidden
      extra={
        paper ? (
          <Button
            type="primary"
            icon={<ReadOutlined />}
            onClick={() => {
              navigate(`/paper/${encodeURIComponent(paper.id)}`);
              onClose();
            }}
          >
            进入阅读
          </Button>
        ) : undefined
      }
    >
      {paper && (
        <Flex vertical gap={16}>
          <Descriptions column={1} size="small" items={items} />
          <div>
            <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
              摘要
            </Typography.Title>
            {paper.abstract ? (
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }} type="secondary">
                {paper.abstract}
              </Typography.Paragraph>
            ) : (
              <Typography.Text type="secondary">暂无摘要</Typography.Text>
            )}
          </div>
          <Flex gap={8} wrap>
            {paper.externalUrl && (
              <Button icon={<LinkOutlined />} href={paper.externalUrl} target="_blank" rel="noreferrer">
                原文
              </Button>
            )}
            <Button icon={<LinkOutlined />} href={`https://arxiv.org/abs/${paper.id}`} target="_blank" rel="noreferrer">
              arXiv
            </Button>
            {paper.hasPdf && (
              <Button
                icon={<FilePdfOutlined />}
                href={`/rawPDF/${paper.id}.pdf`}
                target="_blank"
                rel="noreferrer"
              >
                PDF
              </Button>
            )}
            <Button
              icon={<MessageOutlined />}
              onClick={() => {
                navigate(`/paper/${encodeURIComponent(paper.id)}`);
                onClose();
              }}
            >
              论文对话
            </Button>
          </Flex>
        </Flex>
      )}
    </Drawer>
  );
}
