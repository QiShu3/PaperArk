import { useState, useEffect, useMemo } from 'react';
import { Button, Flex, Input, List, Select, Spin, Typography } from 'antd';
import { LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '@/api';
import type { ChunkRow } from '@/types';
import { Markdown } from '@/lib/markdown';

interface Props {
  paperId: string;
  onActiveChunkChange?: (heading: string, content: string) => void;
}

export default function ChunkView({ paperId, onActiveChunkChange }: Props) {
  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<ChunkRow[] | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .getChunks(paperId)
      .then((rows) => {
        setChunks(rows);
        setActiveIndex(0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载分段失败'))
      .finally(() => setLoading(false));
  }, [paperId]);

  const activeChunk = chunks[activeIndex];

  const nonEmpty = useMemo(() => chunks.filter((c) => c.char_count > 0), [chunks]);

  useEffect(() => {
    if (activeChunk) {
      onActiveChunkChange?.(activeChunk.heading, activeChunk.content);
    }
  }, [activeChunk, onActiveChunkChange]);

  const handleSearch = () => {
    const q = searchQ.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    api
      .getChunks(paperId, q)
      .then((rows) => setSearchResults(rows))
      .catch(() => setSearchResults([]));
  };

  const jumpTo = (chunk: ChunkRow) => {
    const idx = chunks.findIndex((c) => c.id === chunk.id);
    if (idx !== -1) setActiveIndex(idx);
    setSearchResults(null);
    setSearchQ('');
  };

  if (loading) {
    return (
      <Flex align="center" justify="center" style={{ height: '100%' }}>
        <Spin />
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex align="center" justify="center" style={{ height: '100%' }}>
        <Typography.Text type="danger">{error}</Typography.Text>
      </Flex>
    );
  }

  if (chunks.length === 0) {
    return (
      <Flex align="center" justify="center" style={{ height: '100%' }}>
        <Typography.Text type="secondary">暂无分段数据</Typography.Text>
      </Flex>
    );
  }

  const parentHeading = activeChunk?.parent_id
    ? chunks.find((c) => c.id === activeChunk.parent_id)?.heading
    : null;

  return (
    <Flex vertical style={{ height: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
        {parentHeading && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            {parentHeading}
          </Typography.Text>
        )}
        <Flex align="center" gap={8}>
          <Typography.Title level={5} style={{ margin: 0, flex: 1, minWidth: 0 }} ellipsis>
            {activeChunk?.heading}
          </Typography.Title>
          <Flex align="center" gap={4}>
            <Button type="text" size="small" icon={<LeftOutlined />} disabled={activeIndex === 0} onClick={() => setActiveIndex((i) => i - 1)} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {activeIndex + 1} / {chunks.length}
            </Typography.Text>
            <Button type="text" size="small" icon={<RightOutlined />} disabled={activeIndex === chunks.length - 1} onClick={() => setActiveIndex((i) => i + 1)} />
          </Flex>
        </Flex>
        <Select
          style={{ width: '100%', marginTop: 8 }}
          value={activeIndex}
          onChange={(v) => setActiveIndex(Number(v))}
          options={nonEmpty.map((c) => ({ value: c.chunk_index, label: c.heading }))}
          showSearch
          optionFilterProp="label"
          size="small"
        />
      </div>

      <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
        <Flex gap={8}>
          <Input
            prefix={<SearchOutlined />}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onPressEnter={handleSearch}
            placeholder="搜索分段…"
            allowClear
            size="small"
          />
          <Button size="small" onClick={handleSearch}>
            搜索
          </Button>
        </Flex>
        {searchResults !== null && (
          <List
            size="small"
            style={{ marginTop: 8, maxHeight: 160, overflowY: 'auto' }}
            dataSource={searchResults}
            locale={{ emptyText: '无匹配结果' }}
            renderItem={(r) => (
              <List.Item onClick={() => jumpTo(r)} style={{ cursor: 'pointer' }}>
                <div>
                  <Typography.Text style={{ fontSize: 12 }}>{r.heading}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                    {r.content.slice(0, 80).replace(/\s+/g, ' ')}…
                  </Typography.Text>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px' }}>
        {activeChunk?.content ? (
          <Markdown content={activeChunk.content} className="markdown-inline-img" />
        ) : (
          <Flex align="center" justify="center" style={{ height: '100%' }}>
            <Typography.Text type="secondary">此段无内容</Typography.Text>
          </Flex>
        )}
      </div>
    </Flex>
  );
}
