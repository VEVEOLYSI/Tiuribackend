import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './expenses.service.js';
import { ok, paginated, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const expenseSchema = z.object({
  description: z.string().min(1).max(500),
  amount:      z.number().positive(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categoryId:  z.string().uuid().optional(),
  branchId:    z.string().uuid().optional(),
  receiptUrl:  z.string().url().optional(),
  notes:       z.string().max(500).optional(),
});

export const listCategories = async (c: Context<AppEnv>) =>
  ok(c, await svc.listCategories());

export const list = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { categoryId?: string; branchId?: string; startDate?: string; endDate?: string; approved?: string; page?: string; limit?: string };
  const result = await svc.listExpenses(q);
  return paginated(c, result.data, result.meta);
};

export const get = async (c: Context<AppEnv>) =>
  ok(c, await svc.getExpense(c.req.param('id')!));

export const create = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = expenseSchema.parse(await c.req.json());
  return ok(c, await svc.createExpense(user.id, body), 201);
};

export const update = async (c: Context<AppEnv>) => {
  const body = expenseSchema.partial().parse(await c.req.json());
  return ok(c, await svc.updateExpense(c.req.param('id')!, body));
};

export const approve = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  return ok(c, await svc.approveExpense(user.id, c.req.param('id')!));
};

export const remove = async (c: Context<AppEnv>) => {
  await svc.deleteExpense(c.req.param('id')!);
  return noContent(c);
};

export const summary = async (c: Context<AppEnv>) => {
  const { startDate, endDate, branchId } = c.req.query() as { startDate?: string; endDate?: string; branchId?: string };
  return ok(c, await svc.getExpenseSummary({ startDate, endDate, branchId }));
};
