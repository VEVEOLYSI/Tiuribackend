import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './client-notes.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth);
router.use('*', requireRole('staff', 'admin'));

router.get('/',                       requireRole('admin'), ctrl.listAll);
router.get('/client/:clientId',       ctrl.listForClient);
router.post('/',                      ctrl.create);
router.patch('/:id',                  ctrl.update);
router.delete('/:id',                 ctrl.remove);

export default router;
