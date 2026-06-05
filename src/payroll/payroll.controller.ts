import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './payroll.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:       z.string().max(500).optional(),
});

export const list = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { status?: string; page?: string; limit?: string };
  const result = await svc.listRuns(q);
  return paginated(c, result.data, result.meta);
};

export const get = async (c: Context<AppEnv>) =>
  ok(c, await svc.getRun(c.req.param('id')!));

export const create = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = createSchema.parse(await c.req.json());
  return ok(c, await svc.createRun(user.id, body), 201);
};

export const calculate = async (c: Context<AppEnv>) =>
  ok(c, await svc.calculateRunItems(c.req.param('id')!));

export const approve = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  return ok(c, await svc.approveRun(user.id, c.req.param('id')!));
};

export const markPaid = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  return ok(c, await svc.markRunPaid(user.id, c.req.param('id')!));
};

export const myPayslips = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const q = c.req.query() as { page?: string; limit?: string };
  const result = await svc.getOwnPayslips(user.id, q);
  return paginated(c, result.data, result.meta);
};
