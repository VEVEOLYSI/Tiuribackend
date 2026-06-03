import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './promotions.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.get('/', ctrl.list);
router.get('/flash-sales', ctrl.flashSales);
router.post('/', requireAuth, requireRole('admin'), ctrl.create);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.update);
router.post('/:id/items', requireAuth, requireRole('admin'), ctrl.addFlashItem);

export default router;
