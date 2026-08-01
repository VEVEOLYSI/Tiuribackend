import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './services.service.js';
import { ok } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const serviceSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  price: z.number().nonnegative(),
  durationMinutes: z.number().int().positive(),
  capacity: z.number().int().positive().default(1),
  images: z.array(z.object({ url: z.string(), alt: z.string().optional() })).default([]),
  category: z.string().optional(),
  videoUrl: z.string().url().nullable().optional(),
  isFeatured: z.boolean().default(false),
  metaTitle: z.string().max(200).optional(),
  metaDescription: z.string().max(500).optional(),
});

const slotSchema = z.object({
  staffId: z.string().uuid().optional(),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  capacity: z.number().int().positive().default(1),
});

export const list = async (c: Context<AppEnv>) => {
  const category = c.req.query('category');
  return ok(c, await svc.listServices(category));
};

export const getBySlug = async (c: Context<AppEnv>) => {
  const { slug } = c.req.param();
  return ok(c, await svc.getServiceBySlug(slug));
};

export const getSlots = async (c: Context<AppEnv>) => {
  const { id } = c.req.param();
  const date = c.req.query('date');
  return ok(c, await svc.getServiceSlots(id, date));
};

export const create = async (c: Context<AppEnv>) => {
  const body = serviceSchema.parse(await c.req.json());
  return ok(c, await svc.createService(body), 201);
};

export const update = async (c: Context<AppEnv>) => {
  const { id } = c.req.param();
  const body = serviceSchema.partial().extend({ isActive: z.boolean().optional() }).parse(await c.req.json());
  return ok(c, await svc.updateService(id, body));
};

export const remove = async (c: Context<AppEnv>) => {
  const { id } = c.req.param();
  await svc.deleteService(id);
  return c.body(null, 204);
};

export const addSlot = async (c: Context<AppEnv>) => {
  const { id } = c.req.param();
  const body = slotSchema.parse(await c.req.json());
  return ok(c, await svc.createSlot(id, body), 201);
};
