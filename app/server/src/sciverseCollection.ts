import fs from 'node:fs';
import path from 'node:path';
import { PAPERS_ROOT } from './paths.js';
import { logger } from './logger.js';

const COLLECTION_FILE = path.join(PAPERS_ROOT, 'sciverse-collection.json');

export interface SciverseFavorite {
  doc_id: string;
  unique_id?: string;
  title: string;
  authors: string[];
  year?: string;
  venue?: string;
  abstract?: string;
  doi?: string;
  externalUrl?: string;
  addedAt: string;
}

function readAll(): SciverseFavorite[] {
  try {
    const raw = JSON.parse(fs.readFileSync(COLLECTION_FILE, 'utf-8'));
    return Array.isArray(raw) ? (raw as SciverseFavorite[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: SciverseFavorite[]): void {
  fs.mkdirSync(path.dirname(COLLECTION_FILE), { recursive: true });
  fs.writeFileSync(COLLECTION_FILE, JSON.stringify(items, null, 2) + '\n', 'utf-8');
}

export function listFavorites(): SciverseFavorite[] {
  return readAll();
}

export function getFavorite(docId: string): SciverseFavorite | null {
  return readAll().find((f) => f.doc_id === docId) ?? null;
}

export function addFavorite(item: Omit<SciverseFavorite, 'addedAt'>): SciverseFavorite {
  const items = readAll();
  if (items.some((f) => f.doc_id === item.doc_id)) {
    return items.find((f) => f.doc_id === item.doc_id)!;
  }
  const fav: SciverseFavorite = { ...item, addedAt: new Date().toISOString() };
  items.unshift(fav);
  writeAll(items);
  logger.info({ docId: item.doc_id, title: item.title }, 'sciverse favorite added');
  return fav;
}

export function removeFavorite(docId: string): boolean {
  const items = readAll();
  const next = items.filter((f) => f.doc_id !== docId);
  if (next.length === items.length) return false;
  writeAll(next);
  logger.info({ docId }, 'sciverse favorite removed');
  return true;
}
