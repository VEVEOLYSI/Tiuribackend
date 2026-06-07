import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './admin.service.js';
import { ok, paginated } from '../utils/response.js';
import type { AppEnv, OrderStatus, BookingStatus, UserRole } from '../types/index.js';

const ip = (c: Context<AppEnv>) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim();

// Stats
export const getStats = async (c: Context<AppEnv>) =>
  ok(c, await svc.getAdminStats());

export const getStaffStats = async (c: Context<AppEnv>) =>
  ok(c, await svc.getStaffStats());

// Staff invite
export const inviteStaff = async (c: Context<AppEnv>) => {
  const actor = c.get('user')!;
  const body = z.object({
    email:    z.string().email(),
    name:     z.string().min(1).max(100),
    role:     z.enum(['staff', 'admin']).optional(),
    branchId: z.string().uuid().optional(),
  }).parse(await c.req.json());
  return ok(c, await svc.inviteStaff(actor.id, body), 201);
};

// Users
export const listUsers = async (c: Context<AppEnv>) => {
  const result = await svc.listUsers(c.req.query());
  return paginated(c, result.data, result.meta);
};

export const updateRole = async (c: Context<AppEnv>) => {
  const actor = c.get('user')!;
  const { id } = c.req.param();
  const { role } = z.object({ role: z.enum(['customer', 'staff', 'admin']) }).parse(await c.req.json());
  return ok(c, await svc.updateUserRole(actor.id, id, role as UserRole, ip(c)));
};

export const toggleBan = async (c: Context<AppEnv>) => {
  const actor = c.get('user')!;
  const { id } = c.req.param();
  const { ban } = z.object({ ban: z.boolean() }).parse(await c.req.json());
  return ok(c, await svc.toggleUserBan(actor.id, id, ban, ip(c)));
};

// Orders
export const listOrders = async (c: Context<AppEnv>) => {
  const result = await svc.listAllOrders(c.req.query());
  return paginated(c, result.data, result.meta);
};

export const updateOrderStatus = async (c: Context<AppEnv>) => {
  const actor = c.get('user')!;
  const { id } = c.req.param();
  const { status } = z
    .object({ status: z.enum(['pending', 'paid', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded']) })
    .parse(await c.req.json());
  return ok(c, await svc.updateOrderStatus(actor.id, id, status as OrderStatus, ip(c)));
};

// Bookings
export const listBookings = async (c: Context<AppEnv>) => {
  const result = await svc.listAllBookings(c.req.query());
  return paginated(c, result.data, result.meta);
};

export const updateBookingStatus = async (c: Context<AppEnv>) => {
  const actor = c.get('user')!;
  const { id } = c.req.param();
  const { status } = z
    .object({ status: z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']) })
    .parse(await c.req.json());
  return ok(c, await svc.updateBookingStatus(actor.id, id, status as BookingStatus, ip(c)));
};

// Reviews
export const listPendingReviews = async (c: Context<AppEnv>) => {
  const result = await svc.listPendingReviews(c.req.query());
  return paginated(c, result.data, result.meta);
};

export const approveReview = async (c: Context<AppEnv>) => {
  const actor = c.get('user')!;
  const { id } = c.req.param();
  const { approve, adminResponse } = z
    .object({ approve: z.boolean(), adminResponse: z.string().optional() })
    .parse(await c.req.json());
  return ok(c, await svc.approveReview(actor.id, id, approve, adminResponse));
};

// Audit
export const listAuditLogs = async (c: Context<AppEnv>) => {
  const result = await svc.listAuditLogs(c.req.query());
  return paginated(c, result.data, result.meta);
};
