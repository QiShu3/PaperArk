import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Loader2 } from 'lucide-react';
import type { Settings } from '@/types';
import { api } from '@/api';

const KEY = 'papers-settings';

export function getSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { apiKey: raw.apiKey || '', model: raw.model || 'v4-flash' };
  } catch {
    return { apiKey: '', model: 'v4-flash' };
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    return await api.getSettings();
  } catch {
    return getSettings();
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  api.saveSettings(s).catch(() => {});
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

export default function SettingsDialog({ open, onOpenChange, settings, onSettingsChange }: Props) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setApiKey(settings.apiKey);
    setModel(settings.model);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    const next: Settings = { apiKey: apiKey.trim(), model };
    saveSettings(next);
    onSettingsChange(next);
    onOpenChange(false);
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>配置 AI 助手所需的参数</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-1.5">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowKey(!showKey)}
                className="shrink-0 text-xs"
              >
                {showKey ? '隐藏' : '显示'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <a
                href="https://platform.deepseek.com/api_keys"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                注册 DeepSeek API Key
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label>默认模型</Label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="v4-flash">v4-flash</option>
              <option value="v4-pro">v4-pro</option>
            </select>
            <p className="text-xs text-muted-foreground">
              v4-flash：快速响应，适合日常提问。v4-pro：深度推理，适合复杂分析。
            </p>
          </div>

          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            API Key 保存在服务端 settings.json，通过后端代理转发至 DeepSeek
            API，全程不经过第三方服务器。
          </div>

          <Button onClick={handleSave} className="w-full" disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null} 保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
