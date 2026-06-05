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

// ─── ERP modules ──────────────────────────────────────────────────────────────
import branchesRouter from './branches/branches.routes.js';
import clientNotesRouter from './client-notes/client-notes.routes.js';
import staffRouter from './staff/staff.routes.js';
import hrRouter from './hr/hr.routes.js';
import commissionsRouter from './commissions/commissions.routes.js';
import payrollRouter from './payroll/payroll.routes.js';
import inventoryRouter from './inventory/inventory.routes.js';
import suppliersRouter from './suppliers/suppliers.routes.js';
import expensesRouter from './expenses/expenses.routes.js';
import assetsRouter from './assets/assets.routes.js';

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

app.use(
  secureHeaders({
    // HSTS: force HTTPS for 1 year, include subdomains
    strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
    // Prevent clickjacking
    xFrameOptions: 'DENY',
    // Prevent MIME sniffing
    xContentTypeOptions: 'nosniff',
    // Modern browsers: disable legacy XSS filter (CSP handles it)
    xXssProtection: '0',
    // Don't leak referrer to third parties
    referrerPolicy: 'strict-origin-when-cross-origin',
    // Cross-origin isolation
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-site',
  })
);

// Restrict browser feature access
app.use((c, next) => {
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  return next();
});

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

// ─── ERP routes ───────────────────────────────────────────────────────────────
api.route('/branches', branchesRouter);
api.route('/client-notes', clientNotesRouter);
api.route('/staff-dashboard', staffRouter);
api.route('/hr', hrRouter);
api.route('/commissions', commissionsRouter);
api.route('/payroll', payrollRouter);
api.route('/inventory', inventoryRouter);
api.route('/suppliers', suppliersRouter);
api.route('/expenses', expensesRouter);
api.route('/assets', assetsRouter);

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

// ─── Error handler ────────────────────────────────────────────────────────────

app.onError(errorHandler);

export default app;
