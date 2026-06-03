import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './wishlist.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);

router.get('/', ctrl.list);
router.post('/', ctrl.add);
router.delete('/:productId', ctrl.remove);

export default router;
