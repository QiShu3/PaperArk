export default function PdfViewer({ url, title }: { url: string; title?: string }) {
  return (
    <iframe
      src={url}
      title={title ?? 'PDF'}
      style={{ height: '100%', width: '100%', borderRadius: 8, border: '1px solid rgba(5,5,5,0.1)' }}
    />
  );
}
