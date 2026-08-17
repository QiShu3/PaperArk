import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Flex, Input, List, Skeleton, Select, Space, Tag, Typography } from 'antd';
import {
  CalendarOutlined,
  FilePdfOutlined,
  LinkOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import type { Paper, Settings as SettingsType } from '../types';
import { useDirection, GLOBAL_DIRECTION } from '../context/DirectionContext';
import UploadDialog from '../components/UploadDialog';
import SettingsDialog from '../components/SettingsDialog';
import PaperPreviewDrawer from '../components/PaperPreviewDrawer';
import { formatDate, parseSource, sourceLabel } from '../lib/paperMeta';
import { getSettings, loadSettings, saveSettings } from '../lib/settings';

type SortKey = 'addedDesc' | 'addedAsc' | 'yearDesc' | 'yearAsc' | 'titleAsc';

function sortPapers(list: Paper[], sortBy: SortKey): Paper[] {
  const arr = [...list];
  const addedOf = (p: Paper): number | undefined =>
    p.addedAt ? Date.parse(p.addedAt) : undefined;
  const yearOf = (p: Paper): number | undefined =>
    p.year && !Number.isNaN(Number(p.year)) ? Number(p.year) : undefined;
  const cmpNum = (a?: number, b?: number): number => {
    if (a === b) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    return a - b;
  };

  switch (sortBy) {
    case 'addedAsc':
      arr.sort((a, b) => cmpNum(addedOf(a), addedOf(b)));
      break;
    case 'yearDesc':
      arr.sort((a, b) => cmpNum(yearOf(b), yearOf(a)));
      break;
    case 'yearAsc':
      arr.sort((a, b) => cmpNum(yearOf(a), yearOf(b)));
      break;
    case 'titleAsc':
      arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
      break;
    default:
      arr.sort((a, b) => cmpNum(addedOf(b), addedOf(a)));
  }
  return arr;
}

function PaperRow({
  paper,
  onPreview,
}: {
  paper: Paper & { snippet?: string };
  onPreview: (paper: Paper) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`预览 ${paper.title}`}
      onClick={() => onPreview(paper)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPreview(paper);
        }
      }}
      style={{
        border: '1px solid rgba(5,5,5,0.08)',
        borderRadius: 10,
        padding: 16,
        cursor: 'pointer',
        transition: 'box-shadow 0.2s',
      }}
      className="paper-row"
    >
      <Flex gap={16}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ fontSize: 15, fontWeight: 600, color: 'inherit', display: 'block', marginBottom: 6 }}
          >
            {paper.title}
          </div>
          {paper.authors && paper.authors.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              {paper.authors.join(' · ')}
            </Typography.Text>
          )}
          <Flex gap={8} wrap align="center" style={{ marginBottom: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
              {paper.id}
            </Typography.Text>
            {paper.venue && (
              <Tag style={{ fontSize: 11, marginRight: 0 }}>
                {paper.venue}
                {paper.year ? ` ${paper.year}` : ''}
              </Tag>
            )}
            {paper.area && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {paper.area}
              </Typography.Text>
            )}
            {paper.addedAt && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                <CalendarOutlined /> {formatDate(paper.addedAt)}
              </Typography.Text>
            )}
            {(paper.source ?? '').endsWith('-auto') && (
              <Tag icon={<ThunderboltOutlined />} color="gold" style={{ fontSize: 11, marginRight: 0 }}>
                {sourceLabel(paper.source)} · 自动
              </Tag>
            )}
            {paper.source && !(paper.source ?? '').endsWith('-auto') && (
              <Tag color="purple" style={{ fontSize: 11, marginRight: 0 }}>
                {sourceLabel(paper.source)}
              </Tag>
            )}
            {paper.doi && (
              <Tag color="cyan" style={{ fontSize: 11, marginRight: 0 }}>
                DOI
              </Tag>
            )}
            {!paper.hasMd && <Tag style={{ fontSize: 11, marginRight: 0 }}>无 MD</Tag>}
          </Flex>
          {paper.directions?.map((d) => (
            <Tag key={d} style={{ fontSize: 11, marginRight: 4 }}>
              {d}
            </Tag>
          ))}
          {paper.snippet && (
            <Typography.Text type="secondary" style={{ fontSize: 12, fontStyle: 'italic', display: 'block' }}>
              {paper.snippet}
            </Typography.Text>
          )}
          {paper.tags.length > 0 && (
            <Flex gap={4} wrap style={{ marginTop: 8 }}>
              {paper.tags.map((t) => (
                <Tag key={t} color="blue" style={{ fontSize: 11, marginRight: 0 }}>
                  {t}
                </Tag>
              ))}
            </Flex>
          )}
        </div>
        <Flex vertical align="flex-end" gap={4}>
          {paper.externalUrl && (
            <a
              href={paper.externalUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}
            >
              <LinkOutlined /> 原文
            </a>
          )}
          <a
            href={`https://arxiv.org/abs/${paper.id}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}
          >
            <LinkOutlined /> arXiv
          </a>
          {paper.hasPdf && (
            <a
              href={`/rawPDF/${paper.id}.pdf`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}
            >
              <FilePdfOutlined /> PDF
            </a>
          )}
        </Flex>
      </Flex>
    </div>
  );
}

export default function PaperList() {
  const navigate = useNavigate();
  const { direction } = useDirection();
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
  const [autoOnly, setAutoOnly] = useState(false);
  const [acceptedOnly, setAcceptedOnly] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [hasDoiOnly, setHasDoiOnly] = useState(false);
  const [yearFilter, setYearFilter] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortKey>('addedDesc');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewPaper, setPreviewPaper] = useState<Paper | null>(null);
  const [settings, setSettings] = useState<SettingsType>(getSettings);

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => {});
  }, []);

  const handleSettingsChange = (s: SettingsType) => {
    setSettings(s);
    saveSettings(s);
  };

  const papersQ = useQuery({ queryKey: ['papers'], queryFn: api.listPapers });
  const tagsQ = useQuery({ queryKey: ['tags'], queryFn: api.listTags });
  const researchQ = useQuery({ queryKey: ['research-config'], queryFn: api.getResearchConfig });

  const searching = query.trim().length >= 2;
  const searchQ = useQuery({
    queryKey: ['search', query.trim()],
    queryFn: () => api.search(query.trim()),
    enabled: searching,
  });

  const baseList = searching ? (searchQ.data ?? []) : (papersQ.data ?? []);
  const activeDirection =
    direction !== GLOBAL_DIRECTION &&
    (researchQ.data?.directions.some((d) => d.name === direction) ?? false)
      ? direction
      : GLOBAL_DIRECTION;

  const yearCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of papersQ.data ?? []) {
      if (p.year) map.set(p.year, (map.get(p.year) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
  }, [papersQ.data]);

  const venueCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of papersQ.data ?? []) {
      if (!p.venue) continue;
      map.set(p.venue, (map.get(p.venue) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
  }, [papersQ.data]);

  const sourceCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of papersQ.data ?? []) {
      const s = parseSource(p.source);
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [papersQ.data]);

  const filtered = useMemo(() => {
    return baseList.filter(
      (p) =>
        (activeDirection === GLOBAL_DIRECTION || (p.directions ?? []).includes(activeDirection)) &&
        (!yearFilter || p.year === yearFilter) &&
        (!selectedVenues.length || (p.venue && selectedVenues.includes(p.venue))) &&
        (!autoOnly || (p.source ?? '').endsWith('-auto')) &&
        (!acceptedOnly || (p.venue && p.venue !== '未收录')) &&
        (!selectedSources.length || selectedSources.includes(parseSource(p.source))) &&
        (!hasDoiOnly || !!p.doi) &&
        selectedTags.every((t) => p.tags.includes(t)),
    );
  }, [baseList, selectedTags, selectedVenues, autoOnly, acceptedOnly, selectedSources, hasDoiOnly, activeDirection, yearFilter]);

  const sorted = useMemo(() => sortPapers(filtered, sortBy), [filtered, sortBy]);

  const loading = papersQ.isLoading || (searching && searchQ.isLoading);
  const error = papersQ.error || (searching ? searchQ.error : null);

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px' }}>
        <Flex vertical gap={12}>
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {activeDirection === GLOBAL_DIRECTION ? 'Papers 知识库' : activeDirection}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              共 {filtered.length} 篇论文
            </Typography.Text>
          </div>
          <Flex align="center" justify="space-between" gap={16}>
            <Space>
              <Button icon={<MessageOutlined />} onClick={() => navigate('/chat')}>
                全局对话
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => navigate('/research')}>
                研究方向
              </Button>
              <Button icon={<ThunderboltOutlined />} onClick={() => navigate('/browse')}>
                快速浏览
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>
                新增论文
              </Button>
            </Space>
            <Button type="text" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} aria-label="设置" />
          </Flex>
        </Flex>

        <div style={{ marginTop: 24 }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索标题或正文（至少 2 个字符）…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            allowClear
          />
        </div>

        <Flex gap={12} wrap style={{ marginTop: 12 }} align="center">
          <Space size={4} wrap>
            <Tag
              color={autoOnly ? 'blue' : 'default'}
              style={{ cursor: 'pointer', fontSize: 13, padding: '4px 10px' }}
              onClick={() => setAutoOnly((v) => !v)}
            >
              自动收录
            </Tag>
            <Tag
              color={acceptedOnly ? 'blue' : 'default'}
              style={{ cursor: 'pointer', fontSize: 13, padding: '4px 10px' }}
              onClick={() => setAcceptedOnly((v) => !v)}
            >
              已中刊
            </Tag>
            <Tag
              color={hasDoiOnly ? 'blue' : 'default'}
              style={{ cursor: 'pointer', fontSize: 13, padding: '4px 10px' }}
              onClick={() => setHasDoiOnly((v) => !v)}
            >
              有 DOI
            </Tag>
          </Space>
          <Select
            mode="multiple"
            value={selectedSources}
            onChange={(v: string[]) => setSelectedSources(v)}
            placeholder="来源"
            style={{ minWidth: 140, maxWidth: 240 }}
            maxTagCount="responsive"
            allowClear
            options={sourceCounts.map(([s, count]) => ({ value: s, label: `${sourceLabel(s)} (${count})` }))}
            aria-label="按来源筛选"
          />
          <Select
            mode="multiple"
            value={selectedVenues}
            onChange={(v: string[]) => setSelectedVenues(v)}
            placeholder="会议 / 期刊"
            style={{ minWidth: 160, maxWidth: 280 }}
            maxTagCount="responsive"
            allowClear
            options={venueCounts.map(([v, count]) => ({ value: v, label: `${v} (${count})` }))}
            aria-label="按会议筛选"
          />
          <Select
            mode="multiple"
            value={selectedTags}
            onChange={(v: string[]) => setSelectedTags(v)}
            placeholder="标签"
            style={{ minWidth: 120, maxWidth: 200 }}
            maxTagCount="responsive"
            allowClear
            options={(tagsQ.data ?? []).map((t) => ({ value: t.tag, label: `${t.tag} (${t.count})` }))}
            aria-label="按标签筛选"
          />
          <Select
            value={yearFilter}
            onChange={(v) => setYearFilter(v ?? undefined)}
            placeholder="年份"
            style={{ width: 130 }}
            allowClear
            options={yearCounts.map(([y, count]) => ({ value: y, label: `${y} (${count})` }))}
            aria-label="按年份筛选"
          />
          <Select
            value={sortBy}
            onChange={(v) => setSortBy(v as SortKey)}
            style={{ width: 130 }}
            options={[
              { value: 'addedDesc', label: '最新收录' },
              { value: 'addedAsc', label: '最早收录' },
              { value: 'yearDesc', label: '年份最新' },
              { value: 'yearAsc', label: '年份最早' },
              { value: 'titleAsc', label: '标题 A-Z' },
            ]}
            aria-label="排序方式"
          />
        </Flex>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} active paragraph={{ rows: 2 }} />)}

          {!loading && error && (
            <Typography.Text type="danger" style={{ textAlign: 'center', padding: '32px 0', display: 'block' }}>
              加载失败：{error instanceof Error ? error.message : '未知错误'}
            </Typography.Text>
          )}

          {!loading && !error && filtered.length === 0 && (
            <Typography.Text type="secondary" style={{ textAlign: 'center', padding: '40px 0', display: 'block' }}>
              {searching || autoOnly || acceptedOnly || selectedTags.length > 0 || selectedVenues.length > 0
                ? '没有匹配的论文'
                : '知识库暂无论文，点击右上角新增'}
            </Typography.Text>
          )}

          {!loading && !error && sorted.map((p) => (
            <PaperRow key={p.id} paper={p} onPreview={(paper) => setPreviewPaper(paper)} />
          ))}
        </div>
      </div>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onCreated={(id) => navigate(`/paper/${id}`)} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={handleSettingsChange}
      />
      <PaperPreviewDrawer paper={previewPaper} onClose={() => setPreviewPaper(null)} />
    </div>
  );
}
