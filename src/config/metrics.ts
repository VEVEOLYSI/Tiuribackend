import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();
register.setDefaultLabels({ app: 'wigsweb' });

collectDefaultMetrics({ register });

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const activeConnections = new Gauge({
  name: 'http_active_connections',
  help: 'Active HTTP connections',
  registers: [register],
});

export const ordersCreatedTotal = new Counter({
  name: 'orders_created_total',
  help: 'Total orders created',
  labelNames: ['status'] as const,
  registers: [register],
});

export const bookingsCreatedTotal = new Counter({
  name: 'bookings_created_total',
  help: 'Total service bookings created',
  registers: [register],
});

export const paymentsProcessedTotal = new Counter({
  name: 'payments_processed_total',
  help: 'Total payments processed',
  labelNames: ['gateway', 'status'] as const,
  registers: [register],
});
