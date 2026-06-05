import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './payroll.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);

// Staff: view own payslips
router.get('/my-payslips', requireRole('staff', 'admin'), ctrl.myPayslips);

// Admin: full payroll management
router.get('/runs',                   requireRole('admin'), ctrl.list);
router.post('/runs',                  requireRole('admin'), ctrl.create);
router.get('/runs/:id',               requireRole('admin'), ctrl.get);
router.post('/runs/:id/calculate',    requireRole('admin'), ctrl.calculate);
router.post('/runs/:id/approve',      requireRole('admin'), ctrl.approve);
router.post('/runs/:id/pay',          requireRole('admin'), ctrl.markPaid);

export default router;
