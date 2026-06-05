import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './admin.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth, requireRole('admin'));

router.get('/stats',          ctrl.getStats);
router.get('/stats/staff',    ctrl.getStaffStats);
router.post('/staff/invite',  ctrl.inviteStaff);
router.get('/users',          ctrl.listUsers);
router.put('/users/:id/role', ctrl.updateRole);
router.put('/users/:id/ban',  ctrl.toggleBan);

router.get('/orders', ctrl.listOrders);
router.put('/orders/:id/status', ctrl.updateOrderStatus);

router.get('/bookings', ctrl.listBookings);
router.put('/bookings/:id/status', ctrl.updateBookingStatus);

router.get('/reviews/pending', ctrl.listPendingReviews);
router.put('/reviews/:id/approve', ctrl.approveReview);

router.get('/audit-logs', ctrl.listAuditLogs);

export default router;
