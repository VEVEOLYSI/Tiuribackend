import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './bookings.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);

router.get('/',              ctrl.list);
router.get('/:id',           ctrl.get);
router.post('/',             ctrl.create);
router.post('/:id/cancel',   ctrl.cancel);
router.post('/:id/start',    requireRole('admin', 'staff'), ctrl.startBooking);
router.post('/:id/complete', requireRole('admin', 'staff'), ctrl.completeBooking);
router.post('/walk-in',      requireRole('admin', 'staff'), ctrl.createWalkin);
router.patch('/:id/assign',  requireRole('admin'), ctrl.assignStaff);

export default router;
