import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './suppliers.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const supplierSchema = z.object({
  name:        z.string().min(1).max(200),
  contactName: z.string().max(100).optional(),
  email:       z.string().email().optional(),
  phone:       z.string().max(20).optional(),
  address:     z.string().max(300).optional(),
  notes:       z.string().max(500).optional(),
});

const poSchema = z.object({
  supplierId: z.string().uuid(),
  items: z.array(z.object({
    itemId:    z.string().uuid(),
    quantity:  z.number().positive(),
    unitCost:  z.number().min(0),
  })).min(1),
  notes:      z.string().max(500).optional(),
  expectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const receiveSchema = z.object({
  items: z.array(z.object({
    itemId:      z.string().uuid(),
    receivedQty: z.number().min(0),
  })).min(1),
});

export const list = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { search?: string; page?: string; limit?: string };
  const result = await svc.listSuppliers(q);
  return paginated(c, result.data, result.meta);
};

export const get = async (c: Context<AppEnv>) =>
  ok(c, await svc.getSupplier(c.req.param('id')!));

export const create = async (c: Context<AppEnv>) => {
  const body = supplierSchema.parse(await c.req.json());
  return ok(c, await svc.createSupplier(body), 201);
};

export const update = async (c: Context<AppEnv>) => {
  const body = supplierSchema.partial().extend({ isActive: z.boolean().optional() }).parse(await c.req.json());
  return ok(c, await svc.updateSupplier(c.req.param('id')!, body));
};

export const listPOs = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { supplierId?: string; status?: string; page?: string; limit?: string };
  const result = await svc.listPOs(q);
  return paginated(c, result.data, result.meta);
};

export const getPO = async (c: Context<AppEnv>) =>
  ok(c, await svc.getPO(c.req.param('poId')!));

export const createPO = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = poSchema.parse(await c.req.json());
  return ok(c, await svc.createPO(user.id, body), 201);
};

export const receivePO = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { items } = receiveSchema.parse(await c.req.json());
  return ok(c, await svc.receivePO(user.id, c.req.param('poId')!, items));
};

export const sendPO = async (c: Context<AppEnv>) =>
  ok(c, await svc.updatePOStatus(c.req.param('poId')!, 'sent'));

export const cancelPO = async (c: Context<AppEnv>) =>
  ok(c, await svc.updatePOStatus(c.req.param('poId')!, 'cancelled'));
