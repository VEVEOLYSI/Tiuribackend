import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './auth.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/logout', requireAuth, ctrl.logout);
router.post('/refresh', ctrl.refresh);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password', requireAuth, ctrl.resetPassword);
router.get('/me', requireAuth, ctrl.getMe);

export default router;
