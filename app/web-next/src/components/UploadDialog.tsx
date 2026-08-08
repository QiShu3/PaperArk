import { useRef, useState } from 'react';
import { App, Button, Form, Input, Modal, Space } from 'antd';
import { InboxOutlined, LoadingOutlined, UploadOutlined } from '@ant-design/icons';
import { api } from '../api';

export default function UploadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [id, setId] = useState('');
  const [tags, setTags] = useState('');
  const [venue, setVenue] = useState('');
  const [year, setYear] = useState('');
  const [area, setArea] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setFile(null);
    setId('');
    setTags('');
    setVenue('');
    setYear('');
    setArea('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const pickFile = (f: File | null) => {
    setFile(f);
    if (f && !id.trim()) setId(f.name.replace(/\.pdf$/i, ''));
  };

  const submit = async () => {
    if (!file) {
      message.error('请选择 PDF 文件');
      return;
    }
    setLoading(true);
    try {
      const tagList = tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const paper = await api.createPaper(
        file,
        id.trim() || file.name.replace(/\.pdf$/i, ''),
        tagList,
        venue.trim() || undefined,
        year.trim() || undefined,
        area.trim() || undefined,
      );
      message.success('解析完成，已加入知识库');
      onOpenChange(false);
      reset();
      onCreated(paper.id);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '解析失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => !loading && onOpenChange(false)}
      title="新增论文"
      okText={loading ? '解析中…' : '上传并解析'}
      cancelText="取消"
      onOk={submit}
      okButtonProps={{ disabled: loading || !file, icon: loading ? <LoadingOutlined /> : <UploadOutlined /> }}
      destroyOnHidden
      width={520}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
        <div>
          <div
            style={{
              border: '1px dashed #d9d9d9',
              borderRadius: 8,
              padding: 20,
              textAlign: 'center',
              cursor: 'pointer',
              background: file ? 'rgba(0,150,0,0.04)' : 'rgba(0,0,0,0.02)',
            }}
            onClick={() => fileRef.current?.click()}
          >
            <InboxOutlined style={{ fontSize: 32, color: 'rgba(0,0,0,0.45)' }} />
            <div style={{ marginTop: 8 }}>
              {file ? file.name : '点击选择 PDF 文件'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>
              后端将调用 MinerU 自动解析为 Markdown，耗时 30 秒至数分钟
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <Form layout="vertical">
          <Form.Item label="论文 ID（arXiv ID）" style={{ marginBottom: 12 }}>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="例如 2601.12345v1"
            />
          </Form.Item>
          <Form.Item label="标签（逗号分隔，可选）" style={{ marginBottom: 12 }}>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例如 概念擦除, 对抗攻击"
            />
          </Form.Item>
          <Form.Item label="发表会议/期刊（可选）" style={{ marginBottom: 12 }}>
            <Input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="例如 NeurIPS"
            />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item label="发表年份（可选）" style={{ marginBottom: 0, flex: 1 }}>
              <Input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="例如 2025"
              />
            </Form.Item>
            <Form.Item label="研究方向（可选）" style={{ marginBottom: 0, flex: 1 }}>
              <Input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="例如 图像分类"
              />
            </Form.Item>
          </Space>
        </Form>
      </div>
    </Modal>
  );
}
