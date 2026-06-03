import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './analytics.service.js';
import { ok } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const periodSchema = z.enum(['7d', '30d', '90d', '1y']).default('30d');

export const revenue = async (c: Context<AppEnv>) => {
  const period = periodSchema.parse(c.req.query('period'));
  return ok(c, await svc.getRevenueSummary(period as '7d' | '30d' | '90d' | '1y'));
};

export const orders = async (c: Context<AppEnv>) => ok(c, await svc.getOrderAnalytics());

export const topProducts = async (c: Context<AppEnv>) => {
  const limit = Math.min(50, Number(c.req.query('limit') ?? 10));
  return ok(c, await svc.getTopProducts(limit));
};

export const customers = async (c: Context<AppEnv>) => ok(c, await svc.getCustomerAnalytics());

export const bookings = async (c: Context<AppEnv>) => {
  const period = z.enum(['7d', '30d', '90d']).default('30d').parse(c.req.query('period'));
  return ok(c, await svc.getBookingAnalytics(period));
};

export const inventory = async (c: Context<AppEnv>) => ok(c, await svc.getInventoryAlerts());
