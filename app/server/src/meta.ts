import fs from 'node:fs';
import { META_FILE } from './paths.js';

export interface PaperMeta {
  tags: string[];
  notes?: string;
  addedAt?: string;
  venue?: string;
  year?: string;
  area?: string;
  source?: string;
  directions?: string[];
}

export type MetaStore = Record<string, PaperMeta>;

export function readMeta(): MetaStore {
  try {
    const raw = fs.readFileSync(META_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeMeta(store: MetaStore): void {
  fs.writeFileSync(META_FILE, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}
