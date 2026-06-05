import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './branches.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);

router.get('/',         ctrl.list);
router.get('/:id',      ctrl.get);
router.get('/:id/staff', requireRole('admin'), ctrl.listStaff);
router.post('/',        requireRole('admin'), ctrl.create);
router.patch('/:id',    requireRole('admin'), ctrl.update);
router.delete('/:id',   requireRole('admin'), ctrl.remove);

export default router;
