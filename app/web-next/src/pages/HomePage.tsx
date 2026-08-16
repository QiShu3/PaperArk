import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Avatar, Card, Divider, Flex, Skeleton, Tag, Typography } from 'antd';
import { DatabaseOutlined, GlobalOutlined } from '@ant-design/icons';
import { api } from '@/api';

export default function HomePage() {
  const papersQ = useQuery({ queryKey: ['papers'], queryFn: api.listPapers });
  const sciverseQ = useQuery({ queryKey: ['sciverse-status'], queryFn: api.sciverseStatus });

  const paperCount = papersQ.isSuccess ? papersQ.data.length : undefined;

  let sciverseState: { text: string; color: string } | undefined;
  if (sciverseQ.isSuccess) {
    const s = sciverseQ.data;
    sciverseState =
      s.enabled === false
        ? { text: '未启用', color: 'default' }
        : s.tokenConfigured
          ? { text: '已连接', color: 'green' }
          : { text: '未配置 Token', color: 'orange' };
  }

  return (
    <Flex
      vertical
      align="center"
      justify="center"
      style={{ minHeight: '100vh', padding: '48px 24px' }}
    >
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <Typography.Title level={1} style={{ marginBottom: 8 }}>
          Papers 研究助手
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 15 }}>
          本地论文库与全球文献检索的统一入口
        </Typography.Text>
      </div>

      <Flex gap={24} wrap justify="center" style={{ maxWidth: 900, width: '100%' }}>
        <Link
          to="/papers"
          aria-label="进入本地论文库"
          style={{ flex: '1 1 340px', maxWidth: 440, textDecoration: 'none', color: 'inherit' }}
        >
          <Card hoverable style={{ height: '100%' }}>
            <Flex gap={16} align="flex-start">
              <Avatar
                shape="square"
                size={56}
                icon={<DatabaseOutlined />}
                style={{ backgroundColor: '#1f1f1f', flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  本地论文库
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                  已收录论文的阅读、AI 对话与语义检索入口。支持全文精读、智能问答、中文翻译与研究方向的自动收录。
                </Typography.Paragraph>
              </div>
            </Flex>
            <Divider style={{ margin: '20px 0 12px' }} />
            <Flex align="center" justify="space-between">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                本地知识库
              </Typography.Text>
              {papersQ.isLoading ? (
                <Skeleton.Input active size="small" />
              ) : (
                paperCount !== undefined && <Tag style={{ marginInlineEnd: 0 }}>{paperCount} 篇论文</Tag>
              )}
            </Flex>
          </Card>
        </Link>

        <Link
          to="/sciverse"
          aria-label="进入 Sciverse 工作区"
          style={{ flex: '1 1 340px', maxWidth: 440, textDecoration: 'none', color: 'inherit' }}
        >
          <Card hoverable style={{ height: '100%' }}>
            <Flex gap={16} align="flex-start">
              <Avatar
                shape="square"
                size={56}
                icon={<GlobalOutlined />}
                style={{ backgroundColor: '#1677ff', flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  Sciverse 工作区
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                  面向全球文献的 AI 研究助手。语义检索、结构化检索、全文精读、引用关系、图表与收藏入库，回答可溯源。
                </Typography.Paragraph>
              </div>
            </Flex>
            <Divider style={{ margin: '20px 0 12px' }} />
            <Flex align="center" justify="space-between">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                全球文献库
              </Typography.Text>
              {sciverseQ.isLoading ? (
                <Skeleton.Input active size="small" />
              ) : (
                sciverseState && (
                  <Tag color={sciverseState.color} style={{ marginInlineEnd: 0 }}>
                    {sciverseState.text}
                  </Tag>
                )
              )}
            </Flex>
          </Card>
        </Link>
      </Flex>
    </Flex>
  );
}
