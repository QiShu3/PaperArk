import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Upload } from 'lucide-react';
import { api } from '../api';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

export default function UploadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
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
      toast.error('请选择 PDF 文件');
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
      toast.success('解析完成,已加入知识库');
      qc.invalidateQueries({ queryKey: ['papers'] });
      qc.invalidateQueries({ queryKey: ['tags'] });
      onOpenChange(false);
      reset();
      onCreated(paper.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '解析失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增论文</DialogTitle>
          <DialogDescription>
            上传 PDF,后端将调用 MinerU 自动解析为 Markdown。解析可能耗时 30 秒至数分钟,请耐心等待。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>PDF 文件</Label>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-accent"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paper-id">论文 ID(arXiv ID)</Label>
            <Input
              id="paper-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="例如 2601.12345v1"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paper-tags">标签(逗号分隔,可选)</Label>
            <Input
              id="paper-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例如 概念擦除, 对抗攻击"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paper-venue">发表会议/期刊(可选)</Label>
            <Input
              id="paper-venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="例如 NeurIPS"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="paper-year">发表年份(可选)</Label>
              <Input
                id="paper-year"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="例如 2025"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paper-area">研究方向(可选)</Label>
              <Input
                id="paper-area"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="例如 图像分类"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={submit} disabled={loading || !file}>
            {loading ? (
              <>
                <Loader2 className="animate-spin" /> 解析中…
              </>
            ) : (
              <>
                <Upload /> 上传并解析
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
