import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './reviews.service.js';
import { ok, paginated, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createSchema = z.object({
  targetType: z.enum(['product', 'service']),
  productId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  orderItemId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(200).optional(),
  comment: z.string().max(2000).optional(),
  images: z.array(z.object({ url: z.string(), alt: z.string().optional() })).default([]),
});

export const list = async (c: Context<AppEnv>) => {
  const { type, id } = c.req.param() as { type: 'product' | 'service'; id: string };
  const result = await svc.listReviews(type, id, c.req.query());
  return paginated(c, result.data, result.meta);
};

export const create = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = createSchema.parse(await c.req.json());
  return ok(c, await svc.createReview(user.id, body), 201);
};

export const update = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  const body = z
    .object({
      rating: z.number().int().min(1).max(5).optional(),
      title: z.string().max(200).optional(),
      comment: z.string().max(2000).optional(),
    })
    .parse(await c.req.json());
  return ok(c, await svc.updateReview(user.id, id, body));
};

export const remove = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  await svc.deleteReview(user.id, id);
  return noContent(c);
};
