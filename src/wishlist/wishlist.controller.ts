import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './wishlist.service.js';
import { ok, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export const list = async (c: Context<AppEnv>) => ok(c, await svc.getWishlist(c.get('user')!.id));

export const add = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { productId } = z.object({ productId: z.string().uuid() }).parse(await c.req.json());
  return ok(c, await svc.addToWishlist(user.id, productId), 201);
};

export const remove = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { productId } = c.req.param();
  await svc.removeFromWishlist(user.id, productId);
  return noContent(c);
};
