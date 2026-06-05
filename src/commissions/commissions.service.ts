import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import type { UserRole } from '../types/index.js';

// ─── Rules ────────────────────────────────────────────────────────────────────

export async function listRules() {
  const { data } = await supabaseAdmin
    .from('commission_rules')
    .select('*, services(name)')
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function createRule(payload: {
  name: string;
  serviceId?: string;
  role?: UserRole;
  commissionPct: number;
}) {
  if (!payload.serviceId && !payload.role) {
    throw new BadRequestError('Either serviceId or role must be provided');
  }
  const { data, error } = await supabaseAdmin
    .from('commission_rules')
    .insert({
      name:           payload.name,
      service_id:     payload.serviceId ?? null,
      role:           payload.role ?? null,
      commission_pct: payload.commissionPct,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Rule creation failed');
  return data;
}

export async function updateRule(
  id: string,
  payload: Partial<{ name: string; commissionPct: number; isActive: boolean }>
) {
  const { data, error } = await supabaseAdmin
    .from('commission_rules')
    .update({
      name:           payload.name,
      commission_pct: payload.commissionPct,
      is_active:      payload.isActive,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw new NotFoundError('Rule');
  return data;
}

export async function deleteRule(id: string) {
  const { error } = await supabaseAdmin.from('commission_rules').delete().eq('id', id);
  if (error) throw new BadRequestError(error.message);
}

// ─── Earnings ─────────────────────────────────────────────────────────────────

export async function listEarnings(query: {
  staffId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: string;
  limit?: string;
}) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('commission_earnings')
    .select(
      `id, service_amount, commission_pct, commission_amount, status, created_at,
       profiles!staff_id(name),
       service_bookings(booking_number, scheduled_date, services(name))`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.staffId) q = q.eq('staff_id', query.staffId);
  if (query.status) q = q.eq('status', query.status);
  if (query.startDate) q = q.gte('created_at', query.startDate);
  if (query.endDate) q = q.lte('created_at', query.endDate);

  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getEarningsSummary(query: { startDate?: string; endDate?: string }) {
  let q = supabaseAdmin
    .from('commission_earnings')
    .select('staff_id, status, commission_amount, profiles!staff_id(name)');

  if (query.startDate) q = q.gte('created_at', query.startDate);
  if (query.endDate) q = q.lte('created_at', query.endDate);

  const { data } = await q;
  if (!data) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  const byStaff = new Map<string, { staffId: string; staffName: string; pending: number; paid: number }>();
  for (const row of rows) {
    const staffId: string = row.staff_id;
    const profileArr: { name: string }[] | null = row.profiles;
    const staffName: string = (Array.isArray(profileArr) ? profileArr[0]?.name : null) ?? 'Unknown';
    const entry = byStaff.get(staffId) ?? { staffId, staffName, pending: 0, paid: 0 };
    if (row.status === 'pending') entry.pending += Number(row.commission_amount);
    if (row.status === 'paid')    entry.paid    += Number(row.commission_amount);
    byStaff.set(staffId, entry);
  }

  return Array.from(byStaff.values());
}
