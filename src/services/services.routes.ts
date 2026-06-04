import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './services.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.get('/', ctrl.list);
router.get('/:slug', ctrl.getBySlug);
router.get('/:id/slots', ctrl.getSlots);
router.post('/', requireAuth, requireRole('admin'), ctrl.create);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.update);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.remove);
router.post('/:id/slots', requireAuth, requireRole('admin', 'staff'), ctrl.addSlot);

export default router;
