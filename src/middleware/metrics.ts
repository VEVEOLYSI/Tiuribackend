import { createMiddleware } from 'hono/factory';
import {
  httpRequestsTotal,
  httpRequestDuration,
  activeConnections,
} from '../config/metrics.js';
import type { AppEnv } from '../types/index.js';

export const metricsMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  activeConnections.inc();
  const end = httpRequestDuration.startTimer();

  await next();

  const route = c.req.routePath ?? c.req.path;
  const labels = {
    method: c.req.method,
    route,
    status: String(c.res.status),
  };

  httpRequestsTotal.inc(labels);
  end(labels);
  activeConnections.dec();
});
