import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './orders.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createOrderSchema = z.object({
  addressId: z.string().uuid().optional(),
  discountCode: z.string().max(50).optional(),
  shippingAmount: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      variantId: z.string().optional(),
      quantity: z.number().int().min(1).max(100),
    })
  ).min(1),
});

export const list = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const q = c.req.query() as { page?: string; limit?: string; status?: string };
  const result = await svc.listOrders(user.id, q);
  return paginated(c, result.data, result.meta);
};

export const get = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  return ok(c, await svc.getOrder(user.id, id));
};

export const create = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = createOrderSchema.parse(await c.req.json());
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return ok(c, await svc.createOrder(user.id, { ...body, ip }), 201);
};

export const cancel = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  const body = z.object({ reason: z.string().max(200).optional() }).parse(await c.req.json().catch(() => ({})));
  return ok(c, await svc.cancelOrder(user.id, id, body.reason));
};
