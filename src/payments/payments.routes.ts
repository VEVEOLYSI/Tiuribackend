import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import * as ctrl from './payments.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

// ─── Public ───────────────────────────────────────────────────────────────────
router.get('/public-key', ctrl.publicKey);
router.get('/paystack/callback', ctrl.callback);
router.post('/paystack/webhook', ctrl.webhook);

// ─── Redirect flow ────────────────────────────────────────────────────────────
router.post('/paystack/initialize', requireAuth, ctrl.initialize);
router.get('/paystack/verify/:reference', requireAuth, ctrl.verify);

// ─── Custom UI / Charge API flow ──────────────────────────────────────────────
router.post('/paystack/charge', requireAuth, ctrl.charge);
router.post('/paystack/submit-pin', requireAuth, ctrl.submitPin);
router.post('/paystack/submit-otp', requireAuth, ctrl.submitOtp);

export default router;
