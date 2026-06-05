import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './staff.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);
router.use('*', requireRole('staff', 'admin'));

router.get('/schedule',                   ctrl.schedule);
router.patch('/bookings/:id/status',      ctrl.updateBookingStatus);
router.get('/commissions',                ctrl.commissions);
router.get('/commissions/summary',        ctrl.commissionSummary);
router.get('/profile',                    ctrl.myProfile);
router.put('/profile',                    ctrl.updateMyProfile);
router.get('/performance',                ctrl.myPerformance);

export default router;
