import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { trimTrailingSlash } from 'hono/trailing-slash';

import { env } from './config/env.js';
import { register } from './config/metrics.js';
import { requestLogger } from './middleware/logger.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import type { AppEnv } from './types/index.js';

import authRouter from './auth/auth.routes.js';
import usersRouter from './users/users.routes.js';
import productsRouter from './products/products.routes.js';
import categoriesRouter from './categories/categories.routes.js';
import servicesRouter from './services/services.routes.js';
import cartRouter from './cart/cart.routes.js';
import ordersRouter from './orders/orders.routes.js';
import bookingsRouter from './bookings/bookings.routes.js';
import paymentsRouter from './payments/payments.routes.js';
import reviewsRouter from './reviews/reviews.routes.js';
import wishlistRouter from './wishlist/wishlist.routes.js';
import promotionsRouter from './promotions/promotions.routes.js';
import notificationsRouter from './notifications/notifications.routes.js';
import uploadRouter from './upload/upload.routes.js';
import analyticsRouter from './analytics/analytics.routes.js';
import adminRouter from './admin/admin.routes.js';
import discountCodesRouter from './discount-codes/discount-codes.routes.js';

const app = new Hono<AppEnv>();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(
  cors({
    origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
    allowHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    maxAge: 86400,
  })
);

app.use(secureHeaders());
app.use(trimTrailingSlash());
app.use(requestLogger);
app.use(metricsMiddleware);
app.use('/api/*', rateLimit());

// ─── Health & Metrics ─────────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString(), env: env.NODE_ENV })
);

app.get('/metrics', async (c) => {
  const token = env.METRICS_TOKEN;
  if (token) {
    const auth = c.req.header('Authorization');
    if (auth !== `Bearer ${token}`) return c.json({ error: 'Unauthorized' }, 401);
  }
  c.header('Content-Type', register.contentType);
  return c.body(await register.metrics());
});

// ─── API routes ───────────────────────────────────────────────────────────────

const api = app.basePath('/api/v1');

api.route('/auth', authRouter);
api.route('/users', usersRouter);
api.route('/products', productsRouter);
api.route('/categories', categoriesRouter);
api.route('/services', servicesRouter);
api.route('/cart', cartRouter);
api.route('/orders', ordersRouter);
api.route('/bookings', bookingsRouter);
api.route('/payments', paymentsRouter);
api.route('/reviews', reviewsRouter);
api.route('/wishlist', wishlistRouter);
api.route('/promotions', promotionsRouter);
api.route('/notifications', notificationsRouter);
api.route('/upload', uploadRouter);
api.route('/analytics', analyticsRouter);
api.route('/admin', adminRouter);
api.route('/discount-codes', discountCodesRouter);

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

// ─── Error handler ────────────────────────────────────────────────────────────

app.onError(errorHandler);

export default app;
