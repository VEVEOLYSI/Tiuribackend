import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './hr.service.js';
import { ok, paginated, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const shiftSchema = z.object({
  staffId:    z.string().uuid(),
  shiftDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime:  z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime:    z.string().regex(/^\d{2}:\d{2}$/).optional(),
  isDayOff:   z.boolean().optional(),
  notes:      z.string().max(300).optional(),
  branchId:   z.string().uuid().optional(),
});

const leaveSchema = z.object({
  leaveType:  z.enum(['annual', 'sick', 'unpaid', 'maternity', 'paternity']),
  startDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason:     z.string().max(500).optional(),
});

const approveSchema = z.object({
  approved:        z.boolean(),
  rejectionReason: z.string().max(300).optional(),
});

// ─── Shifts ───────────────────────────────────────────────────────────────────

export const createShift = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = shiftSchema.parse(await c.req.json());
  return ok(c, await svc.createShift(user.id, body), 201);
};

export const listShifts = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { staffId?: string; startDate?: string; endDate?: string; branchId?: string; page?: string; limit?: string };
  const result = await svc.listShifts(q);
  return paginated(c, result.data, result.meta);
};

export const deleteShift = async (c: Context<AppEnv>) => {
  await svc.deleteShift(c.req.param('id')!);
  return noContent(c);
};

export const myShifts = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { startDate, endDate } = c.req.query() as { startDate?: string; endDate?: string };
  return ok(c, await svc.getOwnShifts(user.id, { startDate, endDate }));
};

// ─── Leave ────────────────────────────────────────────────────────────────────

export const requestLeave = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = leaveSchema.parse(await c.req.json());
  return ok(c, await svc.requestLeave(user.id, body), 201);
};

export const listLeaves = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { staffId?: string; status?: string; page?: string; limit?: string };
  const result = await svc.listLeaves(q);
  return paginated(c, result.data, result.meta);
};

export const myLeaves = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const q = c.req.query() as { status?: string; page?: string; limit?: string };
  const result = await svc.getOwnLeaves(user.id, q);
  return paginated(c, result.data, result.meta);
};

export const approveLeave = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { approved, rejectionReason } = approveSchema.parse(await c.req.json());
  return ok(c, await svc.approveLeave(user.id, c.req.param('id')!, approved, rejectionReason));
};

export const cancelLeave = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  return ok(c, await svc.cancelLeave(user.id, c.req.param('id')!));
};

// ─── Attendance ───────────────────────────────────────────────────────────────

export const clockIn = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = z.object({ branchId: z.string().uuid().optional() }).parse(await c.req.json().catch(() => ({})));
  return ok(c, await svc.clockIn(user.id, body.branchId), 201);
};

export const clockOut = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  return ok(c, await svc.clockOut(user.id));
};

export const listAttendance = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { staffId?: string; startDate?: string; endDate?: string; branchId?: string; page?: string; limit?: string };
  const result = await svc.listAttendance(q);
  return paginated(c, result.data, result.meta);
};

export const myAttendance = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const q = c.req.query() as { startDate?: string; endDate?: string; page?: string; limit?: string };
  const result = await svc.getOwnAttendance(user.id, q);
  return paginated(c, result.data, result.meta);
};

export const adminClockInFor = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { staffId, branchId } = z.object({
    staffId:  z.string().uuid(),
    branchId: z.string().uuid().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.adminClockIn(staffId, branchId, user.id), 201);
};

export const adminClockOutFor = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { staffId } = z.object({ staffId: z.string().uuid() }).parse(await c.req.json());
  return ok(c, await svc.adminClockOut(staffId, user.id));
};
