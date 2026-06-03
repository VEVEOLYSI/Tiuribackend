import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './notifications.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);

router.get('/', ctrl.list);
router.put('/read-all', ctrl.markAllRead);
router.put('/:id/read', ctrl.markRead);

export default router;
