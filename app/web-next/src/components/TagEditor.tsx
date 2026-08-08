import { useState } from 'react';
import { Input, Tag } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

export default function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const t = draft.trim();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft('');
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {tags.map((t) => (
        <Tag key={t} closable onClose={() => onChange(tags.filter((x) => x !== t))}>
          {t}
        </Tag>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="添加标签后回车"
        style={{ width: 140, height: 24, fontSize: 12 }}
      />
    </div>
  );
}
