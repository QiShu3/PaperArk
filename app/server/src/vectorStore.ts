import {
  listChunksForEmbedding,
  updateChunkVector,
  countEmbeddedChunks,
  listChunkVectors,
  type ChunkForEmbedding,
} from './db.js';
import { logger } from './logger.js';

const DEFAULT_SERVICE_URL = 'http://172.16.170.184:17888';
const BATCH_SIZE = 16;
const RECALL_K = 50;

export interface SemanticHit {
  paperId: string;
  chunkIndex: number;
  heading: string;
  content: string;
  score: number;
}

interface EmbedStatus {
  enabled: boolean;
  running: boolean;
  current: number;
  total: number;
  embedded: number;
}

let embedRunning = false;
let embedCurrent = 0;
let embedTotal = 0;

export function serviceUrl(): string {
  return process.env.VECTOR_SERVICE_URL || DEFAULT_SERVICE_URL;
}

export function vectorEnabled(): boolean {
  return process.env.VECTOR_SERVICE_DISABLED !== '1';
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function remoteEmbed(texts: string[]): Promise<{ dense: Float32Array[]; lexical: string[] }> {
  const resp = await fetch(`${serviceUrl()}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`向量服务 /embed 失败 (HTTP ${resp.status})${text ? `：${text.slice(0, 200)}` : ''}`);
  }
  const data = (await resp.json()) as { embeddings: number[][]; lexical_weights: Record<string, number>[] };
  return {
    dense: data.embeddings.map((e) => new Float32Array(e)),
    lexical: data.lexical_weights.map((w) => JSON.stringify(w)),
  };
}

async function remoteRerank(
  query: string,
  passages: string[],
  topK: number,
): Promise<{ index: number; score: number }[]> {
  const resp = await fetch(`${serviceUrl()}/rerank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, passages, top_k: topK }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`向量服务 /rerank 失败 (HTTP ${resp.status})${text ? `：${text.slice(0, 200)}` : ''}`);
  }
  const data = (await resp.json()) as { results: { index: number; score: number }[] };
  return data.results.slice(0, topK);
}

export async function embedChunks(chunks: ChunkForEmbedding[]): Promise<void> {
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const { dense, lexical } = await remoteEmbed(batch.map((c) => c.content));
    for (let j = 0; j < batch.length; j++) {
      const buf = Buffer.from(dense[j].buffer);
      updateChunkVector(batch[j].id, buf, lexical[j]);
    }
    embedCurrent = Math.min(embedCurrent + batch.length, embedTotal);
  }
}

export async function embedPaper(paperId: string): Promise<number> {
  if (!vectorEnabled()) return 0;
  const chunks = listChunksForEmbedding(paperId);
  if (chunks.length === 0) return 0;
  await embedChunks(chunks);
  logger.info({ paperId, chunks: chunks.length }, 'paper chunks embedded');
  return chunks.length;
}

export async function embedAll(): Promise<void> {
  if (embedRunning) throw new Error('已有向量化任务正在进行');
  if (!vectorEnabled()) throw new Error('向量服务未启用');

  const papers = new Map<string, ChunkForEmbedding[]>();
  for (const c of listChunksForEmbedding()) {
    (papers.get(c.paper_id) ?? papers.set(c.paper_id, []).get(c.paper_id)!).push(c);
  }
  const all = [...papers.values()];
  embedRunning = true;
  embedCurrent = 0;
  embedTotal = all.reduce((n, arr) => n + arr.length, 0);
  try {
    for (const chunks of all) {
      await embedChunks(chunks);
    }
    logger.info({ total: embedTotal }, 'library embedding completed');
  } finally {
    embedRunning = false;
  }
}

export function getEmbedStatus(): EmbedStatus {
  return {
    enabled: vectorEnabled(),
    running: embedRunning,
    current: embedCurrent,
    total: embedTotal,
    embedded: countEmbeddedChunks(),
  };
}

/** 语义检索：向量召回 top-50 → 远程 reranker 精排 → top-k */
export async function semanticSearch(
  query: string,
  paperId?: string,
  topK = 5,
): Promise<SemanticHit[]> {
  if (!vectorEnabled()) throw new Error('向量服务未启用');
  const vectors = listChunkVectors(paperId);
  if (vectors.length === 0) return [];

  const { dense } = await remoteEmbed([query]);
  const q = dense[0];
  const scored = vectors
    .map((v, i) => ({ i, s: cosine(q, new Float32Array(v.embedding.buffer, v.embedding.byteOffset, v.embedding.byteLength / 4)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, RECALL_K);

  const cand = scored.map((x) => vectors[x.i]);
  const ranked = await remoteRerank(query, cand.map((c) => c.content), topK);
  return ranked.map(({ index: ri, score }) => {
    const c = cand[ri];
    return {
      paperId: c.paper_id,
      chunkIndex: c.chunk_index,
      heading: c.heading,
      content: c.content,
      score,
    };
  });
}
