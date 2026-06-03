import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './cart.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);

router.get('/', ctrl.getCart);
router.post('/items', ctrl.addItem);
router.put('/items/:id', ctrl.updateItem);
router.delete('/items/:id', ctrl.removeItem);
router.delete('/', ctrl.clearCart);

export default router;
