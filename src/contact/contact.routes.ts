import { Hono } from 'hono';
import { sendContact } from './contact.controller.js';
import type { AppEnv } from '../types/index.js';

const router = new Hono<AppEnv>();

router.post('/', sendContact);

export default router;
