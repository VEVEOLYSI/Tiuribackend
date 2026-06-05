import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './suppliers.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.use('*', requireAuth, requireRole('admin'));

router.get('/',                          ctrl.list);
router.post('/',                         ctrl.create);
router.get('/:id',                       ctrl.get);
router.patch('/:id',                     ctrl.update);

router.get('/purchase-orders',           ctrl.listPOs);
router.post('/purchase-orders',          ctrl.createPO);
router.get('/purchase-orders/:poId',     ctrl.getPO);
router.post('/purchase-orders/:poId/send',    ctrl.sendPO);
router.post('/purchase-orders/:poId/receive', ctrl.receivePO);
router.post('/purchase-orders/:poId/cancel',  ctrl.cancelPO);

export default router;
