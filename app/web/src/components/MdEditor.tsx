import MarkdownView from './MarkdownView';
import { Textarea } from './ui/textarea';

export default function MdEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-2 gap-3">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="h-full min-h-0 resize-none font-mono text-xs leading-relaxed"
      />
      <div className="h-full min-h-0 overflow-auto rounded-md border bg-background p-4">
        <MarkdownView content={value} />
      </div>
    </div>
  );
}
