import { memo, type CSSProperties } from 'react';
import { XMarkdown, type ComponentProps } from '@ant-design/x-markdown';
import Latex from '@ant-design/x-markdown/plugins/Latex';
import '@ant-design/x-markdown/themes/light.css';
import '@ant-design/x-markdown/themes/dark.css';

export function resolveImage(src?: string): string {
  if (!src) return '';
  if (/^https?:\/\//.test(src) || src.startsWith('/') || src.startsWith('data:')) return src;
  const clean = src.replace(/^(\.\/)?images?\//, '').split('/').pop() ?? src;
  return `/MD/images/${clean}`;
}

export const markdownConfig = {
  extensions: Latex({ katexOptions: { throwOnError: false } }),
};

interface MarkdownProps {
  content: string;
  className?: string;
  style?: CSSProperties;
  streaming?: boolean;
}

function markdownComponents(className?: string) {
  return {
    img: (props: ComponentProps) => (
      <img src={resolveImage(props.src as string | undefined)} alt={(props.alt as string) ?? ''} loading="lazy" className={className} />
    ),
  };
}

export const Markdown = memo(function Markdown({ content, className, style, streaming }: MarkdownProps) {
  return (
    <XMarkdown
      content={content}
      className="markdown-body x-markdown-light"
      config={markdownConfig}
      components={markdownComponents(className)}
      openLinksInNewTab
      streaming={streaming ? { hasNextChunk: true } : undefined}
      style={style}
    />
  );
});
