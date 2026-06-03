import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './bookings.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createSchema = z.object({
  serviceId: z.string().uuid(),
  slotId: z.string().uuid().optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().max(500).optional(),
});

export const list = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const q = c.req.query() as { page?: string; limit?: string; status?: string };
  const result = await svc.listBookings(user.id, q);
  return paginated(c, result.data, result.meta);
};

export const get = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  return ok(c, await svc.getBooking(user.id, id));
};

export const create = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = createSchema.parse(await c.req.json());
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return ok(c, await svc.createBooking(user.id, { ...body, ip }), 201);
};

export const cancel = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  const body = z.object({ reason: z.string().max(200).optional() }).parse(await c.req.json().catch(() => ({})));
  return ok(c, await svc.cancelBooking(user.id, id, body.reason));
};
