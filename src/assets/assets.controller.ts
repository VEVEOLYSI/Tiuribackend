import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './assets.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const assetSchema = z.object({
  name:             z.string().min(1).max(200),
  assetNumber:      z.string().max(50).optional(),
  category:         z.string().max(100).optional(),
  branchId:         z.string().uuid().optional(),
  assignedTo:       z.string().uuid().optional(),
  purchaseDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  purchaseCost:     z.number().min(0).optional(),
  supplierId:       z.string().uuid().optional(),
  usefulLifeYears:  z.number().int().positive().optional(),
  salvageValue:     z.number().min(0).optional(),
  location:         z.string().max(200).optional(),
  serialNumber:     z.string().max(100).optional(),
  notes:            z.string().max(500).optional(),
  nextServiceDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const updateSchema = z.object({
  name:            z.string().min(1).max(200).optional(),
  status:          z.enum(['active', 'maintenance', 'retired', 'disposed']).optional(),
  branchId:        z.string().uuid().optional(),
  assignedTo:      z.string().uuid().optional(),
  location:        z.string().max(200).optional(),
  notes:           z.string().max(500).optional(),
  nextServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const maintenanceSchema = z.object({
  serviceDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description:  z.string().min(1).max(500),
  cost:         z.number().min(0).optional(),
  performedBy:  z.string().max(200).optional(),
  nextDueDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const list = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { status?: string; branchId?: string; category?: string; page?: string; limit?: string };
  const result = await svc.listAssets(q);
  return paginated(c, result.data, result.meta);
};

export const get = async (c: Context<AppEnv>) =>
  ok(c, await svc.getAsset(c.req.param('id')!));

export const create = async (c: Context<AppEnv>) => {
  const body = assetSchema.parse(await c.req.json());
  return ok(c, await svc.createAsset(body), 201);
};

export const update = async (c: Context<AppEnv>) => {
  const body = updateSchema.parse(await c.req.json());
  return ok(c, await svc.updateAsset(c.req.param('id')!, body));
};

export const listMaintenance = async (c: Context<AppEnv>) =>
  ok(c, await svc.listMaintenance(c.req.param('id')!));

export const addMaintenance = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = maintenanceSchema.parse(await c.req.json());
  return ok(c, await svc.addMaintenance(user.id, c.req.param('id')!, body), 201);
};

export const depreciation = async (c: Context<AppEnv>) =>
  ok(c, await svc.getDepreciation(c.req.param('id')!));
