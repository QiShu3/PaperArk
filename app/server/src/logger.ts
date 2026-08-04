import pino from 'pino';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  (req as Request & { requestId: string }).requestId =
    (req.headers['x-request-id'] as string) || randomUUID();
  next();
}

export function getRequestId(req: Request): string {
  return (req as Request & { requestId: string }).requestId ?? '-';
}
