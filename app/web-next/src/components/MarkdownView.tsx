import { useRef, useCallback, useState, useEffect } from 'react';
import { Markdown } from '@/lib/markdown';

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
    <div ref={ref} onMouseUp={handleMouseUp} style={{ position: 'relative' }}>
      <Markdown content={content} className="markdown-inline-img" />

      {floating && (
        <div
          ref={toolbarRef}
          style={{
            position: 'fixed',
            zIndex: 1000,
            left: floating.x,
            top: floating.y,
            transform: 'translate(-50%, -100%)',
            borderRadius: 8,
            background: '#fff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            border: '1px solid rgba(0,0,0,0.08)',
          }}
        >
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={sendToAssistant}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
              border: 'none',
              background: 'transparent',
              padding: '6px 12px',
              fontSize: 12,
              cursor: 'pointer',
              borderRadius: 8,
            }}
          >
            <span style={{ fontSize: 14 }}>✉</span>
            添加到上下文
          </button>
        </div>
      )}
    </div>
  );
}
