import MarkdownView from './MarkdownView';
import { Input } from 'antd';

export default function MdEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, height: '100%', minHeight: 0 }}>
      <Input.TextArea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        style={{ height: '100%', minHeight: 0, resize: 'none', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}
      />
      <div style={{ height: '100%', minHeight: 0, overflowY: 'auto', borderRadius: 8, border: '1px solid rgba(5,5,5,0.1)', padding: 16 }}>
        <MarkdownView content={value} />
      </div>
    </div>
  );
}
