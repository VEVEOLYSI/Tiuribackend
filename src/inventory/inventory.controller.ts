import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './inventory.service.js';
import { ok, paginated, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const itemSchema = z.object({
  name:               z.string().min(1).max(200),
  categoryId:         z.string().uuid().optional(),
  supplierId:         z.string().uuid().optional(),
  sku:                z.string().max(50).optional(),
  unit:               z.string().max(30).optional(),
  unitCost:           z.number().min(0).optional(),
  stockQuantity:      z.number().min(0).optional(),
  lowStockThreshold:  z.number().min(0).optional(),
});

const txnSchema = z.object({
  itemId:        z.string().uuid(),
  type:          z.enum(['stock_in', 'stock_out', 'adjustment', 'wastage', 'return']),
  quantity:      z.number().positive(),
  unitCost:      z.number().min(0).optional(),
  notes:         z.string().max(500).optional(),
  referenceId:   z.string().uuid().optional(),
  referenceType: z.string().max(30).optional(),
});

const usageSchema = z.object({
  serviceId: z.string().uuid(),
  itemId:    z.string().uuid(),
  quantity:  z.number().positive(),
});

export const listCategories = async (c: Context<AppEnv>) =>
  ok(c, await svc.listCategories());

export const createCategory = async (c: Context<AppEnv>) => {
  const { name } = z.object({ name: z.string().min(1).max(100) }).parse(await c.req.json());
  return ok(c, await svc.createCategory(name), 201);
};

export const listItems = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { categoryId?: string; supplierId?: string; lowStockOnly?: string; search?: string; page?: string; limit?: string };
  const result = await svc.listItems(q);
  return paginated(c, result.data, result.meta);
};

export const getItem = async (c: Context<AppEnv>) =>
  ok(c, await svc.getItem(c.req.param('id')!));

export const createItem = async (c: Context<AppEnv>) => {
  const body = itemSchema.parse(await c.req.json());
  return ok(c, await svc.createItem(body), 201);
};

export const updateItem = async (c: Context<AppEnv>) => {
  const body = itemSchema.partial().extend({ isActive: z.boolean().optional() }).parse(await c.req.json());
  return ok(c, await svc.updateItem(c.req.param('id')!, body));
};

export const lowStockAlerts = async (c: Context<AppEnv>) =>
  ok(c, await svc.getLowStockAlerts());

export const recordTransaction = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = txnSchema.parse(await c.req.json());
  return ok(c, await svc.recordTransaction(user.id, body), 201);
};

export const listTransactions = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { itemId?: string; type?: string; startDate?: string; endDate?: string; page?: string; limit?: string };
  const result = await svc.listTransactions(q);
  return paginated(c, result.data, result.meta);
};

export const listServiceUsage = async (c: Context<AppEnv>) => {
  const { serviceId } = c.req.query() as { serviceId?: string };
  return ok(c, await svc.listServiceUsage(serviceId));
};

export const setServiceUsage = async (c: Context<AppEnv>) => {
  const { serviceId, itemId, quantity } = usageSchema.parse(await c.req.json());
  return ok(c, await svc.upsertServiceUsage(serviceId, itemId, quantity), 201);
};

export const removeServiceUsage = async (c: Context<AppEnv>) => {
  const { serviceId, itemId } = z.object({
    serviceId: z.string().uuid(),
    itemId:    z.string().uuid(),
  }).parse(await c.req.json());
  await svc.removeServiceUsage(serviceId, itemId);
  return noContent(c);
};
