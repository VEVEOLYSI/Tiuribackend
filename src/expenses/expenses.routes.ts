import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './expenses.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth, requireRole('admin', 'staff'));

router.get('/categories',       ctrl.listCategories);
router.get('/summary',          requireRole('admin'), ctrl.summary);
router.get('/',                 requireRole('admin'), ctrl.list);
router.post('/',                ctrl.create);
router.get('/:id',              requireRole('admin'), ctrl.get);
router.patch('/:id',            requireRole('admin'), ctrl.update);
router.post('/:id/approve',     requireRole('admin'), ctrl.approve);
router.delete('/:id',           requireRole('admin'), ctrl.remove);

export default router;
