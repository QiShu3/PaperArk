import { useNavigate } from 'react-router-dom';
import { Button, Flex, Typography } from 'antd';
import { ArrowLeftOutlined, HomeOutlined } from '@ant-design/icons';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <Flex vertical align="center" justify="center" gap={16} style={{ minHeight: '100vh', padding: 24 }}>
      <Typography.Title level={1} style={{ margin: 0, fontSize: 72, color: 'rgba(0,0,0,0.2)' }}>
        404
      </Typography.Title>
      <Typography.Title level={4} style={{ margin: 0 }}>
        页面不存在
      </Typography.Title>
      <Typography.Text type="secondary">
        你访问的地址可能拼写有误，或页面已被移动。
      </Typography.Text>
      <Flex gap={8}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回上一页
        </Button>
        <Button type="primary" icon={<HomeOutlined />} onClick={() => navigate('/')}>
          回到首页
        </Button>
      </Flex>
    </Flex>
  );
}
