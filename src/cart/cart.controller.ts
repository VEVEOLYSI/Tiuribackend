import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './cart.service.js';
import { ok, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const addItemSchema = z.object({
  productId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1).max(100).default(1),
  notes: z.string().max(500).optional(),
});

export const getCart = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  return ok(c, await svc.getCart(user.id));
};

export const addItem = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = addItemSchema.parse(await c.req.json());
  return ok(c, await svc.addItem(user.id, body), 201);
};

export const updateItem = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  const { quantity } = z.object({ quantity: z.number().int().min(1).max(100) }).parse(await c.req.json());
  return ok(c, await svc.updateItem(user.id, id, quantity));
};

export const removeItem = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  await svc.removeItem(user.id, id);
  return noContent(c);
};

export const clearCart = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  await svc.clearCart(user.id);
  return noContent(c);
};
