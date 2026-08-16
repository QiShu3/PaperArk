import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Empty, Flex, Image, List, Segmented, Skeleton, Tag, Typography } from 'antd';
import {
  ArrowLeftOutlined,
  LeftOutlined,
  PictureOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import { Markdown, resolveImage } from '../lib/markdown';
import type { OverviewEntry, SectionCategory, SectionInfo } from '../types';

const SECTION_LABELS: Record<SectionCategory, string> = {
  abstract: '摘要',
  introduction: '引言',
  related: '相关工作',
  method: '方法',
  experiments: '实验',
  conclusion: '结论',
  other: '其他',
};

const BROWSABLE_CATEGORIES: SectionCategory[] = [
  'abstract',
  'introduction',
  'related',
  'method',
  'experiments',
  'conclusion',
];

type Filter = SectionCategory | 'all';

const ALL = 'all' as const;

/** 「全部」模式下每篇论文展示分区的优先级（摘要 → 方法 → 实验 → …）。 */
const ALL_PRIORITY: SectionCategory[] = [
  'abstract',
  'method',
  'experiments',
  'conclusion',
  'introduction',
  'related',
];

function sectionOf(p: OverviewEntry, filter: Filter): SectionInfo | null {
  if (filter === ALL) {
    for (const c of ALL_PRIORITY) {
      const s = p.sections[c];
      if (s) return s;
    }
    return null;
  }
  return p.sections[filter] ?? null;
}

export default function BrowsePage() {
  const navigate = useNavigate();

  const overviewQ = useQuery({ queryKey: ['overview'], queryFn: api.getOverviewSections });
  const papers = overviewQ.data?.papers ?? [];

  const [filter, setFilter] = useState<Filter>('abstract');
  const [lang, setLang] = useState<'en' | 'zh'>('en');
  const [activeId, setActiveId] = useState<string | null>(null);

  const activePaper = useMemo(
    () => papers.find((p) => p.paperId === activeId) ?? null,
    [papers, activeId],
  );

  const browseable = useMemo(
    () => papers.filter((p) => sectionOf(p, filter) !== null),
    [papers, filter],
  );

  // 初始 / 筛选后自动选中第一个可浏览论文
  useEffect(() => {
    if (!activeId && browseable.length > 0) setActiveId(browseable[0].paperId);
  }, [browseable, activeId]);

  const activeSection = activePaper ? sectionOf(activePaper, filter) : null;

  // 「全部」模式下反查当前展示分区对应的类别（用于标签展示）
  const activeCategory: SectionCategory | null = useMemo(() => {
    if (!activePaper || !activeSection) return null;
    if (filter !== ALL) return filter;
    for (const c of ALL_PRIORITY) {
      if (activePaper.sections[c] === activeSection) return c;
    }
    return null;
  }, [activePaper, activeSection, filter]);

  const chunksQ = useQuery({
    queryKey: ['chunks', activeId],
    queryFn: () => (activeId ? api.getChunks(activeId) : Promise.resolve([])),
    enabled: !!activeId,
  });

  // 中文模式：按 chunk_index 对齐取译文（译文与原版标题结构 1:1，索引一致）
  const zhChunksQ = useQuery({
    queryKey: ['zh-chunks', activeId],
    queryFn: () => (activeId ? api.getZhChunks(activeId) : Promise.resolve([])),
    enabled: !!activeId && lang === 'zh' && (activePaper?.hasZh ?? false),
  });

  const zhChunk = useMemo(() => {
    if (lang !== 'zh' || !activeSection || !zhChunksQ.data) return undefined;
    return zhChunksQ.data.find((c) => c.chunk_index === activeSection.chunkIndex);
  }, [lang, activeSection, zhChunksQ.data]);

  // 拼接该分区全部 chunk（含编号子节）的完整内容；中文模式优先用对齐索引的译文。
  // 第一个 chunk 不加标题（已在头部展示），后续子节补 `## 标题` 保持结构。
  const activeContent = useMemo(() => {
    if (!activeSection) return '';
    const indexes = activeSection.chunkIndexes ?? [activeSection.chunkIndex];
    const source = lang === 'zh' && zhChunksQ.data ? zhChunksQ.data : chunksQ.data;
    if (!source) return '';
    const parts: string[] = [];
    indexes.forEach((i, idx) => {
      const c = source.find((x) => x.chunk_index === i);
      if (!c || !c.content) return;
      parts.push(idx === 0 ? c.content : `## ${c.heading}\n\n${c.content}`);
    });
    return parts.join('\n\n');
  }, [lang, activeSection, zhChunksQ.data, chunksQ.data]);

  const handleFilterChange = (next: Filter) => {
    setFilter(next);
    if (activePaper && !sectionOf(activePaper, next)) setActiveId(null);
  };

  const move = (dir: 1 | -1) => {
    if (browseable.length === 0) return;
    const idx = browseable.findIndex((p) => p.paperId === activeId);
    const next = (idx + dir + browseable.length) % browseable.length;
    setActiveId(browseable[next].paperId);
  };

  // 键盘 ←/→ 快速翻篇（输入框聚焦时不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t instanceof HTMLInputElement ||
          t instanceof HTMLTextAreaElement ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const position = browseable.findIndex((p) => p.paperId === activeId);

  const availableTags = (p: OverviewEntry) =>
    BROWSABLE_CATEGORIES.filter((c) => p.sections[c]).map((c) => (
      <Tag key={c} color="blue" style={{ fontSize: 11, marginInlineEnd: 4 }}>
        {SECTION_LABELS[c]}
      </Tag>
    ));

  return (
    <Flex vertical style={{ height: '100vh' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(5,5,5,0.06)' }}>
        <Flex align="center" justify="space-between" gap={16}>
          <Flex align="center" gap={12}>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/papers')}
              aria-label="返回"
            />
            <Typography.Title level={5} style={{ margin: 0 }}>
              快速浏览
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              跨论文浏览分区 · ←/→ 翻篇
            </Typography.Text>
          </Flex>
          <Flex align="center" gap={12} wrap>
            <Segmented
              value={lang}
              onChange={(v) => setLang(v as 'en' | 'zh')}
              options={[
                { label: '原文', value: 'en' },
                { label: '中文', value: 'zh' },
              ]}
            />
            <Segmented
              value={filter}
              onChange={(v) => handleFilterChange(v as Filter)}
              options={[
                { label: '摘要', value: 'abstract' },
                { label: '方法', value: 'method' },
                { label: '实验', value: 'experiments' },
                { label: '结论', value: 'conclusion' },
                { label: '引言', value: 'introduction' },
                { label: '相关工作', value: 'related' },
                { label: '全部', value: ALL },
              ]}
            />
          </Flex>
        </Flex>
      </div>

      {overviewQ.isLoading ? (
        <div style={{ padding: 32 }}>
          <Skeleton active paragraph={{ rows: 10 }} />
        </div>
      ) : overviewQ.error || papers.length === 0 ? (
        <Flex align="center" justify="center" style={{ flex: 1 }}>
          <Empty
            description={
              overviewQ.error instanceof Error ? overviewQ.error.message : '暂无可浏览的论文'
            }
          />
        </Flex>
      ) : (
        <Flex style={{ flex: 1, minHeight: 0 }}>
          {/* 左：论文列表 */}
          <div
            style={{
              width: 340,
              minWidth: 260,
              borderRight: '1px solid rgba(5,5,5,0.06)',
              overflowY: 'auto',
            }}
          >
            <List
              size="small"
              dataSource={papers}
              renderItem={(p) => {
                const has = sectionOf(p, filter) !== null;
                const selected = p.paperId === activeId;
                return (
                  <List.Item
                    onClick={() => setActiveId(p.paperId)}
                    style={{
                      cursor: 'pointer',
                      padding: '10px 16px',
                      opacity: has ? 1 : 0.5,
                      background: selected ? 'rgba(22,119,255,0.08)' : undefined,
                    }}
                  >
                    <div style={{ width: '100%', minWidth: 0 }}>
                      <Flex align="center" justify="space-between" gap={8}>
                        <Typography.Text strong ellipsis style={{ flex: 1, minWidth: 0 }}>
                          {p.title}
                        </Typography.Text>
                        {lang === 'zh' && p.hasZh && (
                          <Tag color="green" style={{ fontSize: 10, marginInlineEnd: 0 }}>
                            有译文
                          </Tag>
                        )}
                        {p.year && (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {p.year}
                          </Typography.Text>
                        )}
                      </Flex>
                      <div style={{ marginTop: 4 }}>
                        {has ? (
                          availableTags(p)
                        ) : (
                          <Tag style={{ fontSize: 11, marginInlineEnd: 0 }}>
                            无{filter === ALL ? '分区' : `「${SECTION_LABELS[filter]}」`}
                          </Tag>
                        )}
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
          </div>

          {/* 右：分区内容 */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '20px 28px' }}>
            {!activePaper ? (
              <Flex align="center" justify="center" style={{ height: '100%' }}>
                <Empty description="选择一篇论文开始浏览" />
              </Flex>
            ) : !activeSection ? (
              <Flex vertical align="center" gap={12} style={{ paddingTop: 80 }}>
                <Empty
                  description={
                    filter === ALL
                      ? '该论文没有可浏览的分区'
                      : `该论文没有「${SECTION_LABELS[filter]}」部分`
                  }
                />
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  该论文包含：
                </Typography.Text>
                <Flex wrap gap={4} justify="center">
                  {BROWSABLE_CATEGORIES.filter((c) => activePaper.sections[c]).map((c) => (
                    <Tag
                      key={c}
                      color="blue"
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleFilterChange(c)}
                    >
                      {SECTION_LABELS[c]}
                    </Tag>
                  ))}
                </Flex>
              </Flex>
            ) : (
              <>
                <Flex align="center" justify="space-between" gap={16}>
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/paper/${activePaper.paperId}`}>
                      <Typography.Title level={4} style={{ margin: 0 }} ellipsis>
                        {activePaper.title}
                      </Typography.Title>
                    </Link>
                    <Flex align="center" gap={8} style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        {zhChunk?.heading ?? activeSection.heading}
                      </Typography.Text>
                      <Tag style={{ fontSize: 11, marginInlineEnd: 0 }}>
                        {SECTION_LABELS[activeCategory ?? 'other']}
                      </Tag>
                      {lang === 'zh' && !activePaper.hasZh && (
                        <Tag color="orange" style={{ fontSize: 11, marginInlineEnd: 0 }}>
                          暂无中文翻译，显示原文
                        </Tag>
                      )}
                      {activeSection.images.length > 0 && (
                        <Tag icon={<PictureOutlined />} style={{ fontSize: 11, marginInlineEnd: 0 }}>
                          {activeSection.images.length} 图
                        </Tag>
                      )}
                    </Flex>
                  </div>
                  <Flex align="center" gap={8}>
                    <Button
                      size="small"
                      icon={<LeftOutlined />}
                      disabled={browseable.length === 0}
                      onClick={() => move(-1)}
                      title="上一篇（←）"
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {browseable.length === 0 ? '-' : position + 1} / {browseable.length}
                    </Typography.Text>
                    <Button
                      size="small"
                      icon={<RightOutlined />}
                      disabled={browseable.length === 0}
                      onClick={() => move(1)}
                      title="下一篇（→）"
                    />
                  </Flex>
                </Flex>

                <div style={{ marginTop: 16 }}>
                  {chunksQ.isLoading || zhChunksQ.isLoading ? (
                    <Skeleton active paragraph={{ rows: 6 }} />
                  ) : activeContent ? (
                    <Markdown content={activeContent} className="markdown-inline-img" />
                  ) : (
                    <Typography.Text type="secondary">此部分无内容</Typography.Text>
                  )}
                </div>

                {activeSection.images.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      本部分图片（{activeSection.images.length}）
                    </Typography.Text>
                    <Image.PreviewGroup>
                      <Flex wrap gap={8} style={{ marginTop: 8 }}>
                        {activeSection.images.map((src) => (
                          <Image
                            key={src}
                            src={resolveImage(src)}
                            width={180}
                            height={130}
                            style={{ objectFit: 'cover', borderRadius: 6 }}
                            preview={{ mask: false }}
                          />
                        ))}
                      </Flex>
                    </Image.PreviewGroup>
                  </div>
                )}
              </>
            )}
          </div>
        </Flex>
      )}
    </Flex>
  );
}
