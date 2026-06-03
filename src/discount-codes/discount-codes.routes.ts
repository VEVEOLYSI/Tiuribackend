import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './discount-codes.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.post('/validate', requireAuth, ctrl.validate);
router.get('/', requireAuth, requireRole('admin'), ctrl.list);
router.post('/', requireAuth, requireRole('admin'), ctrl.create);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.update);

export default router;
