import { createMiddleware } from 'hono/factory';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../config/env.js';
import type { AppEnv } from '../types/index.js';

interface HitRecord {
  count: number;
  resetAt: number;
}

// Simple sliding-window in-memory rate limiter
const store = new Map<string, HitRecord>();

// Purge expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of store) {
    if (rec.resetAt <= now) store.delete(key);
  }
}, 5 * 60 * 1000);

// Stricter limiter for login: 5 attempts per minute per IP
export function authRateLimit() {
  return rateLimit(5, 60_000);
}

// Very strict limiter for password reset / resend-verification: 3 per 15 minutes
export function sensitiveRateLimit() {
  return rateLimit(3, 15 * 60_000);
}

export function rateLimit(max = env.RATE_LIMIT_MAX, windowMs = env.RATE_LIMIT_WINDOW_MS) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // X-Forwarded-For is attacker-controlled unless a proxy we trust rewrote
    // it. Honouring it blindly lets anyone rotate the header and walk straight
    // past the login limiter, so it is only read when TRUST_PROXY is set.
    const ip = env.TRUST_PROXY
      ? (c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
         c.req.header('x-real-ip') ??
         'unknown')
      : (getConnInfo(c).remote.address ?? 'unknown');

    const now = Date.now();
    const key = `${ip}:${c.req.path}`;
    let rec = store.get(key);

    if (!rec || rec.resetAt <= now) {
      rec = { count: 1, resetAt: now + windowMs };
      store.set(key, rec);
    } else {
      rec.count++;
    }

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - rec.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(rec.resetAt / 1000)));

    if (rec.count > max) {
      return c.json({ success: false, error: 'Too many requests' }, 429);
    }

    await next();
  });
}
