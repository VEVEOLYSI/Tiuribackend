import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './users.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);

router.get('/profile', ctrl.getProfile);
router.put('/profile', ctrl.updateProfile);
router.get('/addresses', ctrl.listAddresses);
router.post('/addresses', ctrl.createAddress);
router.put('/addresses/:id', ctrl.updateAddress);
router.delete('/addresses/:id', ctrl.deleteAddress);

export default router;
