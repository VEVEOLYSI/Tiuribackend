import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './hr.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);

// ─── Shifts (admin manages, staff views own) ──────────────────────────────────
router.post('/shifts',         requireRole('admin'), ctrl.createShift);
router.get('/shifts',          requireRole('admin'), ctrl.listShifts);
router.delete('/shifts/:id',   requireRole('admin'), ctrl.deleteShift);
router.get('/shifts/mine',     requireRole('staff', 'admin'), ctrl.myShifts);

// ─── Leave (staff requests, admin approves) ───────────────────────────────────
router.post('/leaves',             requireRole('staff', 'admin'), ctrl.requestLeave);
router.get('/leaves',              requireRole('admin'), ctrl.listLeaves);
router.get('/leaves/mine',         requireRole('staff', 'admin'), ctrl.myLeaves);
router.patch('/leaves/:id/approve', requireRole('admin'), ctrl.approveLeave);
router.post('/leaves/:id/cancel',  requireRole('staff', 'admin'), ctrl.cancelLeave);

// ─── Attendance ───────────────────────────────────────────────────────────────
router.post('/attendance/clock-in',       requireRole('staff', 'admin'), ctrl.clockIn);
router.post('/attendance/clock-out',      requireRole('staff', 'admin'), ctrl.clockOut);
router.post('/attendance/admin-clock-in', requireRole('admin'), ctrl.adminClockInFor);
router.post('/attendance/admin-clock-out',requireRole('admin'), ctrl.adminClockOutFor);
router.get('/attendance',                 requireRole('admin'), ctrl.listAttendance);
router.get('/attendance/mine',            requireRole('staff', 'admin'), ctrl.myAttendance);

export default router;
