import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './inventory.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth, requireRole('admin', 'staff'));

router.get('/categories',           ctrl.listCategories);
router.post('/categories',          requireRole('admin'), ctrl.createCategory);

router.get('/items',                ctrl.listItems);
router.post('/items',               requireRole('admin'), ctrl.createItem);
router.get('/items/low-stock',      ctrl.lowStockAlerts);
router.get('/items/:id',            ctrl.getItem);
router.patch('/items/:id',          requireRole('admin'), ctrl.updateItem);

router.get('/transactions',         requireRole('admin'), ctrl.listTransactions);
router.post('/transactions',        ctrl.recordTransaction);

router.get('/service-usage',        ctrl.listServiceUsage);
router.post('/service-usage',       requireRole('admin'), ctrl.setServiceUsage);
router.delete('/service-usage',     requireRole('admin'), ctrl.removeServiceUsage);

export default router;
