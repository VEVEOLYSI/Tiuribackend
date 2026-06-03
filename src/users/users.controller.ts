import type { Context } from 'hono';
import { z } from 'zod';
import * as usersService from './users.service.js';
import { ok, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  avatarUrl: z.string().url().optional(),
});

const addressSchema = z.object({
  label: z.string().max(50).optional(),
  street: z.string().min(1),
  city: z.string().min(1).max(100),
  county: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().length(2).default('KE'),
  isDefault: z.boolean().default(false),
});

export async function getProfile(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const profile = await usersService.getProfile(user.id);
  return ok(c, profile);
}

export async function updateProfile(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const body = updateProfileSchema.parse(await c.req.json());
  const profile = await usersService.updateProfile(user.id, body);
  return ok(c, profile);
}

export async function listAddresses(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const addresses = await usersService.listAddresses(user.id);
  return ok(c, addresses);
}

export async function createAddress(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const body = addressSchema.parse(await c.req.json());
  const address = await usersService.createAddress(user.id, body);
  return ok(c, address, 201);
}

export async function updateAddress(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const { id } = c.req.param();
  const body = addressSchema.partial().parse(await c.req.json());
  const address = await usersService.updateAddress(user.id, id, body);
  return ok(c, address);
}

export async function deleteAddress(c: Context<AppEnv>) {
  const user = c.get('user')!;
  const { id } = c.req.param();
  await usersService.deleteAddress(user.id, id);
  return noContent(c);
}
