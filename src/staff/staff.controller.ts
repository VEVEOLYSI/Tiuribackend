import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './staff.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const statusSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'no_show']),
});

const profileSchema = z.object({
  mpesaNumber:            z.string().max(20).optional(),
  bankName:               z.string().max(100).optional(),
  bankAccount:            z.string().max(50).optional(),
  emergencyContactName:   z.string().max(100).optional(),
  emergencyContactPhone:  z.string().max(20).optional(),
});

export const schedule = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const q = c.req.query() as { date?: string; startDate?: string; endDate?: string; status?: string };
  return ok(c, await svc.getSchedule(user.id, q));
};

export const updateBookingStatus = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  const { status } = statusSchema.parse(await c.req.json());
  return ok(c, await svc.updateBookingStatus(user.id, id, status));
};

export const commissions = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const q = c.req.query() as { page?: string; limit?: string; status?: string; startDate?: string; endDate?: string };
  const result = await svc.getOwnCommissions(user.id, q);
  return paginated(c, result.data, result.meta);
};

export const commissionSummary = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  return ok(c, await svc.getCommissionSummary(user.id));
};

export const myProfile = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  return ok(c, await svc.getOwnStaffProfile(user.id));
};

export const updateMyProfile = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = profileSchema.parse(await c.req.json());
  return ok(c, await svc.upsertStaffProfile(user.id, body));
};

export const myPerformance = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  return ok(c, await svc.getOwnPerformance(user.id));
};
