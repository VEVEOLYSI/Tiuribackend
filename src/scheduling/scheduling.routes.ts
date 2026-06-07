import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './scheduling.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

// Business settings — public read, admin write
router.get('/settings', ctrl.getSettings);
router.put('/settings', requireAuth, requireRole('admin'), ctrl.updateSettings);

// Staff list for scheduling UI
router.get('/staff', requireAuth, requireRole('admin'), ctrl.listStaff);

// Staff schedules
router.get('/staff-schedules',                                   requireAuth, requireRole('admin'), ctrl.listSchedules);
router.put('/staff-schedules/:staffId',                          requireAuth, requireRole('admin'), ctrl.replaceWeeklySchedule);
router.put('/staff-schedules/:staffId/days/:dayOfWeek',          requireAuth, requireRole('admin'), ctrl.upsertScheduleDay);
router.delete('/staff-schedules/:staffId/days/:dayOfWeek',       requireAuth, requireRole('admin'), ctrl.deleteScheduleDay);

export default router;
