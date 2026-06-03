import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './bookings.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);

router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/', ctrl.create);
router.post('/:id/cancel', ctrl.cancel);

export default router;
