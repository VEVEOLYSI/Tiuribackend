import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './categories.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.get('/', ctrl.list);
router.get('/:slug', ctrl.getBySlug);
router.post('/', requireAuth, requireRole('admin'), ctrl.create);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.update);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.remove);

export default router;
