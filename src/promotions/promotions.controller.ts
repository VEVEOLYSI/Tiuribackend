import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './promotions.service.js';
import { ok } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(['banner', 'flash_sale', 'featured_product', 'featured_service']),
  imageUrl: z.string().url().optional(),
  linkUrl: z.string().url().optional(),
  description: z.string().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  sortOrder: z.number().int().default(0),
});

const flashItemSchema = z.object({
  productId: z.string().uuid(),
  salePrice: z.number().nonnegative(),
  stockLimit: z.number().int().positive().optional(),
});

export const list = async (c: Context<AppEnv>) => ok(c, await svc.listActivePromotions());
export const flashSales = async (c: Context<AppEnv>) => ok(c, await svc.getActiveFlashSales());

export const create = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = createSchema.parse(await c.req.json());
  return ok(c, await svc.createPromotion(user.id, body), 201);
};

export const update = async (c: Context<AppEnv>) => {
  const { id } = c.req.param();
  const body = createSchema.partial().extend({ isActive: z.boolean().optional() }).parse(await c.req.json());
  return ok(c, await svc.updatePromotion(id, body));
};

export const addFlashItem = async (c: Context<AppEnv>) => {
  const { id } = c.req.param();
  const body = flashItemSchema.parse(await c.req.json());
  return ok(c, await svc.addFlashSaleItem(id, body), 201);
};
