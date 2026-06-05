import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './assets.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth, requireRole('admin'));

router.get('/',                    ctrl.list);
router.post('/',                   ctrl.create);
router.get('/:id',                 ctrl.get);
router.patch('/:id',               ctrl.update);
router.get('/:id/maintenance',     ctrl.listMaintenance);
router.post('/:id/maintenance',    ctrl.addMaintenance);
router.get('/:id/depreciation',    ctrl.depreciation);

export default router;
