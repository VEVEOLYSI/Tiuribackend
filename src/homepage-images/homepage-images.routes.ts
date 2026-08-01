import { Hono } from 'hono';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as ctrl from './homepage-images.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

// ── Public ───────────────────────────────────────────────────────────────────
// GET /api/v1/homepage-images           — all active images grouped by section
// GET /api/v1/homepage-images?section=hero — filtered to one section
router.get('/', ctrl.listPublic);

// ── Admin ────────────────────────────────────────────────────────────────────
// GET    /api/v1/homepage-images/admin       — all images (incl. inactive)
// POST   /api/v1/homepage-images             — upload a new image
// PATCH  /api/v1/homepage-images/:id         — update metadata / toggle active
// DELETE /api/v1/homepage-images/:id         — delete image (DB + Cloudinary)

router.get('/admin', requireAuth, requireRole('admin'), ctrl.listAdmin);
router.post('/',     requireAuth, requireRole('admin'), ctrl.create);
router.patch('/:id', requireAuth, requireRole('admin'), ctrl.update);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.remove);

export default router;
