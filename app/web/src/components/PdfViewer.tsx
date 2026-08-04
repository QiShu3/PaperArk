export default function PdfViewer({ url, title }: { url: string; title?: string }) {
  return (
    <iframe
      src={url}
      title={title ?? 'PDF'}
      className="h-full w-full rounded-md border bg-muted"
    />
  );
}
