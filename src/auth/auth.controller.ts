import type { Context } from 'hono';
import { z } from 'zod';
import * as authService from './auth.service.js';
import { ok } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

// Enforce meaningful password complexity for a system handling financial + personal data
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const registerSchema = z.object({
  email:    z.string().email(),
  password: passwordSchema,
  name:     z.string().min(1).max(100).trim(),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

export async function register(c: Context<AppEnv>) {
  const body = registerSchema.parse(await c.req.json());
  await authService.register(body.email, body.password, body.name);
  // Intentionally do NOT return the userId — reduces information exposure
  return ok(c, {
    message: 'Account created. Please check your email to verify your address before logging in.',
  }, 201);
}

export async function login(c: Context<AppEnv>) {
  const body = loginSchema.parse(await c.req.json());
  const session = await authService.login(body.email, body.password);
  return ok(c, { session });
}

export async function logout(c: Context<AppEnv>) {
  const token = c.req.header('Authorization')?.slice(7) ?? '';
  await authService.logout(token);
  return ok(c, { message: 'Logged out' });
}

export async function refresh(c: Context<AppEnv>) {
  const { refreshToken } = z
    .object({ refreshToken: z.string() })
    .parse(await c.req.json());
  const session = await authService.refreshSession(refreshToken);
  return ok(c, { session });
}

export async function forgotPassword(c: Context<AppEnv>) {
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  await authService.forgotPassword(email);
  return ok(c, { message: 'If that email exists, a reset link has been sent' });
}

export async function resetPassword(c: Context<AppEnv>) {
  const body = z.object({ password: passwordSchema }).parse(await c.req.json());
  const token = c.req.header('Authorization')?.slice(7) ?? '';
  await authService.resetPassword(token, body.password);
  return ok(c, { message: 'Password updated' });
}

export async function resendVerification(c: Context<AppEnv>) {
  const { email } = z.object({ email: z.string().email() }).parse(await c.req.json());
  await authService.resendVerification(email);
  // Always return the same response — don't reveal whether the email exists
  return ok(c, { message: 'If that email is registered and unverified, a new link has been sent' });
}

export async function getMe(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const profile = await authService.getMe(user.id);
  return ok(c, profile);
}
