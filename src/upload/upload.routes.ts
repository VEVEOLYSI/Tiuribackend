import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './upload.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.post('/image', requireAuth, ctrl.upload);

export default router;
