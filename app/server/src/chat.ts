import { Router, Request, Response } from 'express';
import db from './db.js';
import { readSettings, normalizeBaseUrl } from './settingsStore.js';
import { logger, getRequestId } from './logger.js';

const router = Router();

function toModel(name: string): string {
  if (name === 'v4-pro') return 'deepseek-v4-pro';
  return 'deepseek-v4-flash';
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
  timeoutMs = 120_000,
): Promise<globalThis.Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (resp.ok) return resp;

      if (resp.status === 429 || resp.status >= 500) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          logger.warn({ attempt: attempt + 1, status: resp.status, delay }, 'retrying upstream request');
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return resp;
      }
      return resp;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        logger.warn({ attempt: attempt + 1, err: String(e), delay }, 'retrying upstream request after error');
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

const logStmt = db.prepare(
  `INSERT INTO chat_logs (session_id, round_id, paper_id, model, tool_count, message_count, status, status_code, error_message, cache_hit_tokens, cache_miss_tokens, duration_ms)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

// 连接测试：用表单当前填的值（无需先保存）发一次最小请求，验证 API 可用
router.post('/chat/test', async (req: Request, res: Response) => {
  const raw = req.body as Record<string, unknown> | undefined;
  const settings = readSettings();
  const apiKey =
    typeof raw?.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey.trim() : settings.apiKey;
  const baseUrl = normalizeBaseUrl(raw?.baseUrl ?? settings.baseUrl);
  const model = toModel(
    typeof raw?.model === 'string' && raw.model ? raw.model : settings.model,
  );

  if (!apiKey) {
    res.json({ ok: false, error: '请先填写 API Key' });
    return;
  }

  const startedAt = Date.now();
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const latencyMs = Date.now() - startedAt;

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      res.json({
        ok: false,
        status: resp.status,
        latencyMs,
        error: `HTTP ${resp.status}${text ? `：${text.slice(0, 200)}` : ''}`,
      });
      return;
    }
    const data = (await resp.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    if (!data) {
      res.json({ ok: false, latencyMs, error: '响应解析失败：不是有效的 JSON' });
      return;
    }
    const reply = data.choices?.[0]?.message?.content?.slice(0, 100);
    logger.info({ model, baseUrl, latencyMs }, 'api connection test ok');
    res.json({ ok: true, model, latencyMs, reply: reply || '' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn({ err: e, baseUrl }, 'api connection test failed');
    res.json({ ok: false, latencyMs: Date.now() - startedAt, error: message });
  }
});

router.post('/chat', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const raw = req.body as Record<string, unknown> | undefined;
  const model = typeof raw?.model === 'string' ? raw.model : '';
  const messages = (Array.isArray(raw?.messages) ? raw.messages : []) as { role: string; content: string }[];
  const apiKey = typeof raw?.apiKey === 'string' ? raw.apiKey : '';
  const tools = Array.isArray(raw?.tools) ? (raw.tools as Record<string, unknown>[]) : undefined;
  const paperId = typeof raw?.paperId === 'string' ? raw.paperId : undefined;
  const sessionId = typeof raw?.sessionId === 'string' ? raw.sessionId : undefined;
  const roundId = typeof raw?.roundId === 'string' ? raw.roundId : undefined;

  const toolCount = tools?.length ?? 0;
  const msgCount = messages.length;

  const safeModel = model || 'v4-flash';
  const toolNames: string[] = [];

  const log = (status: string, statusCode: number, errorMessage?: string | null, hit?: number | null, miss?: number | null) => {
    try {
      logStmt.run(sessionId ?? null, roundId ?? null, paperId ?? null, safeModel, toolCount, msgCount, status, statusCode, errorMessage ?? null, hit ?? null, miss ?? null, Date.now() - startTime);
    } catch (e) {
      logger.error({ err: e, requestId: getRequestId(req) }, 'failed to insert chat_logs');
    }
  };

  try {

    if (!model) {
      res.status(400).json({ error: '缺少 model 参数' });
      return;
    }

    if (!apiKey) {
      logger.warn({ requestId: getRequestId(req), model, paperId, sessionId }, 'api key missing');
      log('error', 400, '未配置 API Key');
      res.status(400).json({ error: '请先在设置中配置 API Key' });
      return;
    }

    const body: Record<string, unknown> = {
      model: toModel(model),
      messages,
      stream: true,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const baseUrl = readSettings().baseUrl;
    const resp = await fetchWithRetry(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error(
        { requestId: getRequestId(req), status: resp.status, body: text, model: safeModel, sessionId, roundId },
        'upstream error',
      );
      log('error', resp.status, text);
      res.status(resp.status).json({ error: text });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const reader = resp.body?.getReader();
    if (!reader) {
      logger.error({ requestId: getRequestId(req), sessionId, roundId }, 'no stream reader');
      res.write(`data: ${JSON.stringify({ error: '无法读取流' })}\n\n`);
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let usage: { hit: number; miss: number } | null = null;
    let parseErrors = 0;
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (payload === '[DONE]') {
            if (usage) {
              res.write(`data: ${JSON.stringify({ usage })}\n\n`);
            }
            res.write('data: [DONE]\n\n');

            log('success', 200, null, usage?.hit ?? null, usage?.miss ?? null);
            logger.info(
              {
                requestId: getRequestId(req),
                sessionId,
                roundId,
                model: safeModel,
                duration: Date.now() - startTime,
                tools: toolNames,
                cacheHit: usage?.hit ?? 0,
                cacheMiss: usage?.miss ?? 0,
              },
              'round completed',
            );
            continue;
          }
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name && !toolNames.includes(tc.function.name)) {
                  toolNames.push(tc.function.name);
                }
              }
              res.write(`data: ${JSON.stringify({ tool_calls: delta.tool_calls })}\n\n`);
            }

            const u = parsed.usage;
            if (u && typeof u.prompt_cache_hit_tokens === 'number') {
              usage = {
                hit: u.prompt_cache_hit_tokens,
                miss: u.prompt_cache_miss_tokens ?? 0,
              };
            }
          } catch {
            parseErrors++;
            if (parseErrors <= 3) {
              logger.warn(
                { requestId: getRequestId(req), payload: payload.slice(0, 200) },
                'SSE chunk parse error (sample)',
              );
            }
          }
        }
      }
    } finally {
      if (parseErrors > 0) {
        logger.warn(
          { requestId: getRequestId(req), parseErrors, toolNames, sessionId, roundId },
          'SSE chunk parse errors',
        );
      }
      res.end();
    }
  } catch (e) {
    logger.error(
      { err: e, requestId: getRequestId(req), model: safeModel, sessionId, roundId, toolNames },
      'chat stream crash',
    );
    log('error', 500, String(e));
    if (!res.headersSent) {
      res.status(500).json({ error: String(e) });
    }
  }
});

export default router;
