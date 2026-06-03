import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './discount-codes.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createSchema = z.object({
  code: z.string().min(3).max(50).regex(/^[A-Z0-9_-]+$/i),
  description: z.string().optional(),
  type: z.enum(['percent', 'fixed']),
  value: z.number().positive(),
  minOrderAmount: z.number().nonnegative().optional(),
  maxDiscountCap: z.number().positive().optional(),
  maxUses: z.number().int().positive().optional(),
  maxUsesPerUser: z.number().int().positive().default(1),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const list = async (c: Context<AppEnv>) => {
  const result = await svc.listDiscountCodes(c.req.query());
  return paginated(c, result.data, result.meta);
};

export const create = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = createSchema.parse(await c.req.json());
  return ok(c, await svc.createDiscountCode(user.id, body), 201);
};

export const update = async (c: Context<AppEnv>) => {
  const { id } = c.req.param();
  const body = z
    .object({
      description: z.string().optional(),
      isActive: z.boolean().optional(),
      maxUses: z.number().int().positive().optional(),
      expiresAt: z.string().datetime().optional(),
      startsAt: z.string().datetime().optional(),
    })
    .parse(await c.req.json());
  return ok(c, await svc.updateDiscountCode(id, body));
};

export const validate = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { code, orderAmount } = z
    .object({ code: z.string(), orderAmount: z.number().nonnegative() })
    .parse(await c.req.json());
  return ok(c, await svc.validateCode(code, user.id, orderAmount));
};
