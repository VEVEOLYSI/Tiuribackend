import { Hono } from 'hono';
import { sensitiveRateLimit } from '../middleware/rateLimit.js';
import { sendContact } from './contact.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

// Unauthenticated and it sends mail, so it gets the strict limiter
// rather than the general API allowance.
router.post('/', sensitiveRateLimit(), sendContact);

export default router;
