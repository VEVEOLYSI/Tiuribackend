import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './reviews.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.get('/:type/:id', ctrl.list);
router.post('/', requireAuth, ctrl.create);
router.put('/:id', requireAuth, ctrl.update);
router.delete('/:id', requireAuth, ctrl.remove);

export default router;
