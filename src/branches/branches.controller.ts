import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './branches.service.js';
import { ok, paginated, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createSchema = z.object({
  name:    z.string().min(1).max(100),
  address: z.string().max(300).optional(),
  phone:   z.string().max(20).optional(),
});

const updateSchema = createSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export const list = async (c: Context<AppEnv>) => {
  const all = c.req.query('all') === 'true';
  return ok(c, await svc.listBranches(all));
};

export const get = async (c: Context<AppEnv>) =>
  ok(c, await svc.getBranch(c.req.param('id')!));

export const create = async (c: Context<AppEnv>) => {
  const body = createSchema.parse(await c.req.json());
  return ok(c, await svc.createBranch(body), 201);
};

export const update = async (c: Context<AppEnv>) => {
  const body = updateSchema.parse(await c.req.json());
  return ok(c, await svc.updateBranch(c.req.param('id')!, body));
};

export const remove = async (c: Context<AppEnv>) => {
  await svc.deleteBranch(c.req.param('id')!);
  return noContent(c);
};

export const listStaff = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { page?: string; limit?: string };
  const result = await svc.listBranchStaff(c.req.param('id')!, q);
  return paginated(c, result.data, result.meta);
};
