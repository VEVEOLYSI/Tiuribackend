import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './commissions.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth, requireRole('admin'));

router.get('/rules',            ctrl.listRules);
router.post('/rules',           ctrl.createRule);
router.patch('/rules/:id',      ctrl.updateRule);
router.delete('/rules/:id',     ctrl.deleteRule);
router.get('/earnings',         ctrl.listEarnings);
router.get('/earnings/summary', ctrl.earningsSummary);

export default router;
