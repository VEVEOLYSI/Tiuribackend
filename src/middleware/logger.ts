import { createMiddleware } from 'hono/factory';
import { randomUUID } from 'crypto';
import { logger } from '../config/logger.js';
import type { AppEnv } from '../types/index.js';

// Redact these keys from logged request bodies
const REDACTED_KEYS = new Set(['password', 'token', 'secret', 'card', 'cvv', 'pin', 'passkey']);

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 4 || obj === null || typeof obj !== 'object') return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = randomUUID();
  c.set('requestId', requestId);

  const start = Date.now();
  const { method, path } = c.req;
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown';

  let body: unknown;
  try {
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.includes('application/json') && method !== 'GET') {
      const clone = c.req.raw.clone();
      body = redact(await clone.json());
    }
  } catch {
    // ignore parse failures
  }

  logger.info('→ request', {
    requestId,
    method,
    path,
    ip,
    body,
    userAgent: c.req.header('user-agent'),
  });

  await next();

  const duration = Date.now() - start;
  logger.info('← response', {
    requestId,
    method,
    path,
    status: c.res.status,
    durationMs: duration,
  });
});
