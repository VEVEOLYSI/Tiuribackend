import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './categories.service.js';
import { ok, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const schema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  parentId: z.string().uuid().optional(),
  sortOrder: z.number().int().default(0),
});

export const list = async (c: Context<AppEnv>) => ok(c, await svc.listCategories());

export const getBySlug = async (c: Context<AppEnv>) => {
  const { slug } = c.req.param();
  return ok(c, await svc.getCategoryWithProducts(slug));
};

export const create = async (c: Context<AppEnv>) => {
  const body = schema.parse(await c.req.json());
  return ok(c, await svc.createCategory(body), 201);
};

export const update = async (c: Context<AppEnv>) => {
  const { id } = c.req.param();
  const body = schema.partial().extend({ isActive: z.boolean().optional() }).parse(await c.req.json());
  return ok(c, await svc.updateCategory(id, body));
};

export const remove = async (c: Context<AppEnv>) => {
  const { id } = c.req.param();
  await svc.deleteCategory(id);
  return noContent(c);
};
