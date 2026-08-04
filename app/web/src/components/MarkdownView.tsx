import { useRef, useCallback, useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { remarkLatexDelimiters } from '@/lib/markdownPlugins';
import { Send } from 'lucide-react';

function resolveImage(src?: string): string {
  if (!src) return '';
  if (/^https?:\/\//.test(src) || src.startsWith('/') || src.startsWith('data:')) return src;
  return `/MD/images/${src.replace(/^(\.\/)?images\//, '')}`;
}

interface Props {
  content: string;
  onTextSelect?: (text: string) => void;
}

interface FloatingAction {
  text: string;
  x: number;
  y: number;
}

export default function MarkdownView({ content, onTextSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<FloatingAction | null>(null);

  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setFloating(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text || !ref.current?.contains(sel.anchorNode)) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setFloating({ text, x: rect.left + rect.width / 2, y: rect.top - 8 });
  }, [onTextSelect]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setFloating(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const sendToAssistant = () => {
    if (floating) {
      onTextSelect?.(floating.text);
      setFloating(null);
    }
  };

  return (
    <div
      ref={ref}
      onMouseUp={handleMouseUp}
      className="prose prose-neutral dark:prose-invert max-w-none break-words"
    >
      <ReactMarkdown
        remarkPlugins={[remarkLatexDelimiters, remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          img: ({ src, alt }) => (
            <img
              src={resolveImage(src)}
              alt={alt ?? ''}
              loading="lazy"
              className="max-w-full rounded-md border"
            />
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>

      {floating && (
        <div
          ref={toolbarRef}
          className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border bg-popover shadow-md"
          style={{ left: floating.x, top: floating.y }}
        >
          <button
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs text-popover-foreground transition-colors hover:bg-accent"
            onMouseDown={(e) => e.preventDefault()}
            onClick={sendToAssistant}
          >
            <Send className="size-3" />
            添加到上下文
          </button>
        </div>
      )}
    </div>
  );
}
