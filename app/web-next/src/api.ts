import type {
  Paper,
  PaperDetail,
  SearchResult,
  TagCount,
  ChatMessage,
  ChatSession,
  ChunkRow,
  ToolCallDelta,
  ResearchDirection,
  ResearchConfigDto,
  ResearchRun,
  ClassifyStatus,
  MdTranslationRecord,
  SemanticHit,
  EmbedStatus,
} from './types';

const RETRY_DELAYS = [1000, 3000, 6000];

async function http<T>(url: string, init?: RequestInit, retries = 2): Promise<T> {
  const method = init?.method ?? 'GET';
  const isReadOnly = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: { message?: string } | string }).error;
        const errMsg = typeof msg === 'string' ? msg : msg?.message || res.statusText;
        throw new Error(errMsg);
      }
      return res.json() as Promise<T>;
    } catch (e) {
      if (!isReadOnly || attempt === retries) throw e;
      if (e instanceof TypeError || (e as Error).message?.includes('fetch')) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt] ?? 6000));
        continue;
      }
      throw e;
    }
  }
  throw new Error('请求失败');
}

export type UpdatePatch = Partial<Pick<PaperDetail, 'markdown' | 'tags' | 'notes' | 'venue' | 'year' | 'area'>>;

export type StreamChunk =
  | { type: 'content'; text: string }
  | { type: 'usage'; hit: number; miss: number }
  | { type: 'tool_calls'; calls: ToolCallDelta[] };

async function* chatStream(
  model: string,
  messages: ChatMessage[],
  apiKey: string,
  signal?: AbortSignal,
  tools?: object[],
  paperId?: string,
  sessionId?: string,
  roundId?: string,
): AsyncGenerator<StreamChunk> {
  const body: Record<string, unknown> = { model, messages, apiKey };
  if (tools && tools.length > 0) body.tools = tools;
  if (paperId) body.paperId = paperId;
  if (sessionId) body.sessionId = sessionId;
  if (roundId) body.roundId = roundId;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), 180_000);
  const fetchSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: fetchSignal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error((errBody as { error?: string }).error || '请求失败');
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('无法读取流');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') return;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.content !== undefined) {
            yield { type: 'content', text: parsed.content };
          } else if (parsed.tool_calls) {
            yield { type: 'tool_calls', calls: parsed.tool_calls as ToolCallDelta[] };
          } else if (parsed.usage) {
            yield { type: 'usage', hit: parsed.usage.hit, miss: parsed.usage.miss };
          }
        } catch {
          console.warn('chatStream: failed to parse SSE chunk', line.slice(0, 100));
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  listPapers: () => http<Paper[]>('/api/papers'),
  getPaper: (id: string) => http<PaperDetail>(`/api/papers/${encodeURIComponent(id)}`),
  listTags: () => http<TagCount[]>('/api/tags'),
  search: (q: string) => http<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  updatePaper: (id: string, patch: UpdatePatch) =>
    http<PaperDetail>(`/api/papers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  deletePaper: (id: string) =>
    http<{ ok: boolean }>(`/api/papers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createPaper: (file: File, id: string, tags: string[], venue?: string, year?: string, area?: string) => {
    const fd = new FormData();
    fd.append('pdf', file);
    fd.append('id', id);
    fd.append('tags', tags.join(','));
    if (venue) fd.append('venue', venue);
    if (year) fd.append('year', year);
    if (area) fd.append('area', area);
    return http<PaperDetail>('/api/papers', { method: 'POST', body: fd });
  },
  getImages: (paperId: string) =>
    http<{ images: string[] }>(`/api/papers/${encodeURIComponent(paperId)}/images`),
  getChunks: (paperId: string, q?: string) =>
    http<ChunkRow[]>(`/api/papers/${encodeURIComponent(paperId)}/chunks${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  chat: (
    model: string,
    messages: ChatMessage[],
    apiKey: string,
    signal?: AbortSignal,
    tools?: object[],
    paperId?: string,
    sessionId?: string,
    roundId?: string,
  ) => chatStream(model, messages, apiKey, signal, tools, paperId, sessionId, roundId),
  listSessions: (paperId: string) =>
    http<ChatSession[]>(`/api/papers/${encodeURIComponent(paperId)}/sessions`),
  createSession: (paperId: string, title?: string) =>
    http<ChatSession>(`/api/papers/${encodeURIComponent(paperId)}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }),
  deleteSession: (paperId: string, sessionId: string) =>
    http<{ ok: boolean }>(
      `/api/papers/${encodeURIComponent(paperId)}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    ),
  updateSessionTitle: (paperId: string, sessionId: string, title: string) =>
    http<{ ok: boolean }>(
      `/api/papers/${encodeURIComponent(paperId)}/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      },
    ),
  loadChat: (paperId: string, sessionId: string) =>
    http<{
      id: number;
      role: string;
      content: string;
      tool_calls: string | null;
      tool_call_id: string | null;
      name: string | null;
    }[]>(
      `/api/papers/${encodeURIComponent(paperId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
    ),
  saveChat: (
    paperId: string,
    sessionId: string,
    messages: {
      role: string;
      content: string | null;
      tool_calls?: Record<string, unknown>[];
      tool_call_id?: string;
      name?: string;
    }[],
  ) =>
    http<{ ok: boolean }>(
      `/api/papers/${encodeURIComponent(paperId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      },
    ),
  clearChat: (paperId: string, sessionId: string) =>
    http<{ ok: boolean }>(
      `/api/papers/${encodeURIComponent(paperId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: 'DELETE' },
    ),
  getLogs: (paperId: string, sessionId: string) =>
    http<
      {
        id: number;
        round_id: string | null;
        model: string;
        tool_count: number;
        status: string;
        status_code: number | null;
        error_message: string | null;
        cache_hit_tokens: number | null;
        cache_miss_tokens: number | null;
        duration_ms: number | null;
        created_at: string;
        tool_results: string | null;
      }[]
    >(
      `/api/papers/${encodeURIComponent(paperId)}/sessions/${encodeURIComponent(sessionId)}/logs`,
    ),
  reportRoundLog: (
    paperId: string,
    sessionId: string,
    body: { round_id: string; tool_results: { name: string; success: boolean; error?: string }[] },
  ) =>
    http<{ ok: boolean }>(
      `/api/papers/${encodeURIComponent(paperId)}/sessions/${encodeURIComponent(sessionId)}/logs/round-report`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
  getSettings: () =>
    http<{
      providers: import('./types').LLMProvider[];
      activeProviderId: string;
      model: string;
      mineruToken?: string;
      sources: import('./types').SourceSetting[];
    }>('/api/settings'),
  saveSettings: (s: {
    providers?: import('./types').LLMProvider[];
    activeProviderId?: string;
    model?: string;
    mineruToken?: string;
    sources?: { source: string; enabled: boolean; key?: string }[];
  }) =>
    http<{
      providers: import('./types').LLMProvider[];
      activeProviderId: string;
      model: string;
      mineruToken?: string;
      sources: import('./types').SourceSetting[];
    }>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }),
  testSettings: (s: { apiKey: string; model: string; baseUrl?: string }) =>
    http<{
      ok: boolean;
      model?: string;
      latencyMs?: number;
      error?: string;
      reply?: string;
    }>('/api/chat/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }),
  getResearchConfig: () => http<ResearchConfigDto>('/api/research/directions'),
  createResearchDirection: (d: {
    name: string;
    queries: { source: string; query: string }[];
    enabled?: boolean;
    maxPerRun?: number;
  }) =>
    http<ResearchDirection>('/api/research/directions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    }),
  updateResearchDirection: (
    name: string,
    patch: {
      queries?: { source: string; query: string }[];
      query?: string;
      enabled?: boolean;
      maxPerRun?: number;
    },
  ) =>
    http<ResearchDirection>(`/api/research/directions/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  deleteResearchDirection: (name: string) =>
    http<{ ok: boolean }>(`/api/research/directions/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),
  checkResearch: () =>
    http<{ runId: string }>('/api/research/check', { method: 'POST' }),
  getResearchStatus: () =>
    http<{ running: boolean; run: ResearchRun | null }>('/api/research/status'),
  getResearchRuns: () => http<ResearchRun[]>('/api/research/runs'),
  startClassify: () =>
    http<{ started: boolean }>('/api/research/classify', { method: 'POST' }),
  getClassifyStatus: () => http<ClassifyStatus>('/api/research/classify-status'),
  startMdTranslate: (paperId: string) =>
    http<MdTranslationRecord>(`/api/papers/${encodeURIComponent(paperId)}/translate-md`, {
      method: 'POST',
    }),
  getMdTranslateStatus: (paperId: string) =>
    http<MdTranslationRecord>(`/api/papers/${encodeURIComponent(paperId)}/translate-md`),
  cancelMdTranslate: (paperId: string) =>
    http<MdTranslationRecord>(
      `/api/papers/${encodeURIComponent(paperId)}/translate-md/cancel`,
      { method: 'POST' },
    ),
  semanticSearch: (paperId: string, q: string, topK = 5) =>
    http<SemanticHit[]>(
      `/api/papers/${encodeURIComponent(paperId)}/semantic-search?q=${encodeURIComponent(q)}&top_k=${topK}`,
    ),
  semanticSearchAll: (q: string, topK = 5) =>
    http<SemanticHit[]>(`/api/search/semantic?q=${encodeURIComponent(q)}&top_k=${topK}`),
  embedAll: () =>
    http<{ started: boolean }>('/api/vector/embed-all', { method: 'POST' }),
  getEmbedStatus: () => http<EmbedStatus>('/api/vector/status'),
};
