import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './commissions.service.js';
import { ok, paginated, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const ruleSchema = z.object({
  name:          z.string().min(1).max(100),
  serviceId:     z.string().uuid().optional(),
  role:          z.enum(['customer', 'staff', 'admin']).optional(),
  commissionPct: z.number().min(0).max(100),
});

const updateRuleSchema = z.object({
  name:          z.string().min(1).max(100).optional(),
  commissionPct: z.number().min(0).max(100).optional(),
  isActive:      z.boolean().optional(),
});

export const listRules = async (c: Context<AppEnv>) =>
  ok(c, await svc.listRules());

export const createRule = async (c: Context<AppEnv>) => {
  const body = ruleSchema.parse(await c.req.json());
  return ok(c, await svc.createRule(body), 201);
};

export const updateRule = async (c: Context<AppEnv>) => {
  const body = updateRuleSchema.parse(await c.req.json());
  return ok(c, await svc.updateRule(c.req.param('id')!, body));
};

export const deleteRule = async (c: Context<AppEnv>) => {
  await svc.deleteRule(c.req.param('id')!);
  return noContent(c);
};

export const listEarnings = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { staffId?: string; status?: string; startDate?: string; endDate?: string; page?: string; limit?: string };
  const result = await svc.listEarnings(q);
  return paginated(c, result.data, result.meta);
};

export const earningsSummary = async (c: Context<AppEnv>) => {
  const { startDate, endDate } = c.req.query() as { startDate?: string; endDate?: string };
  return ok(c, await svc.getEarningsSummary({ startDate, endDate }));
};
