import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './analytics.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth, requireRole('admin', 'staff'));

router.get('/revenue', ctrl.revenue);
router.get('/orders', ctrl.orders);
router.get('/top-products', ctrl.topProducts);
router.get('/customers', ctrl.customers);
router.get('/bookings', ctrl.bookings);
router.get('/inventory', ctrl.inventory);

export default router;
