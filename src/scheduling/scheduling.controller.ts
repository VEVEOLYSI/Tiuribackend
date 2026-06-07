import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './scheduling.service.js';
import { ok } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

// ─── Business Settings ────────────────────────────────────────────────────────

export const getSettings = async (c: Context<AppEnv>) =>
  ok(c, await svc.getBusinessSettings());

const settingsSchema = z.object({
  businessStartTime:    z.string().regex(/^\d{2}:\d{2}$/).optional(),
  businessEndTime:      z.string().regex(/^\d{2}:\d{2}$/).optional(),
  slotIntervalMinutes:  z.number().int().min(5).max(120).optional(),
  workingDays:          z.array(z.number().int().min(0).max(6)).optional(),
  staffOrdersEnabled:   z.boolean().optional(),
});

export const updateSettings = async (c: Context<AppEnv>) => {
  const body = settingsSchema.parse(await c.req.json());
  return ok(c, await svc.updateBusinessSettings(body));
};

// ─── Staff Schedules ──────────────────────────────────────────────────────────

export const listSchedules = async (c: Context<AppEnv>) => {
  const staffId = c.req.query('staffId');
  return ok(c, await svc.listStaffSchedules(staffId));
};

export const listStaff = async (c: Context<AppEnv>) =>
  ok(c, await svc.listStaffProfiles());

const scheduleEntrySchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime:   z.string().regex(/^\d{2}:\d{2}$/),
  isActive:  z.boolean().optional(),
});

export const upsertScheduleDay = async (c: Context<AppEnv>) => {
  const { staffId, dayOfWeek } = c.req.param();
  const day = parseInt(dayOfWeek, 10);
  if (isNaN(day) || day < 0 || day > 6) {
    return c.json({ success: false, error: 'dayOfWeek must be 0–6' }, 400);
  }
  const body = scheduleEntrySchema.parse(await c.req.json());
  return ok(c, await svc.upsertStaffSchedule(staffId, day, body));
};

export const deleteScheduleDay = async (c: Context<AppEnv>) => {
  const { staffId, dayOfWeek } = c.req.param();
  const day = parseInt(dayOfWeek, 10);
  await svc.deleteStaffScheduleDay(staffId, day);
  return c.body(null, 204);
};

const weeklyScheduleSchema = z.object({
  days: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime:   z.string().regex(/^\d{2}:\d{2}$/),
  })),
});

export const replaceWeeklySchedule = async (c: Context<AppEnv>) => {
  const { staffId } = c.req.param();
  const { days } = weeklyScheduleSchema.parse(await c.req.json());
  return ok(c, await svc.replaceStaffWeeklySchedule(staffId, days));
};
