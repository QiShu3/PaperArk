import { useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from './ui/badge';
import { Input } from './ui/input';

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
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1 pr-1">
          {t}
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="rounded-sm hover:text-destructive"
            aria-label={`移除标签 ${t}`}
          >
            <X className="size-3" />
          </button>
        </Badge>
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
        className="h-7 w-40 text-xs"
      />
    </div>
  );
}
