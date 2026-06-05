import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import type { BookingStatus } from '../types/index.js';

const STAFF_ALLOWED_TRANSITIONS: Record<string, BookingStatus[]> = {
  confirmed:   ['in_progress', 'no_show'],
  in_progress: ['completed'],
  pending:     ['confirmed', 'no_show'],
};

export async function getSchedule(
  staffId: string,
  query: { date?: string; startDate?: string; endDate?: string; status?: string }
) {
  let q = supabaseAdmin
    .from('staff_daily_schedule')
    .select('*')
    .eq('staff_id', staffId)
    .order('scheduled_date')
    .order('scheduled_time');

  if (query.date) {
    q = q.eq('scheduled_date', query.date);
  } else if (query.startDate && query.endDate) {
    q = q.gte('scheduled_date', query.startDate).lte('scheduled_date', query.endDate);
  } else {
    // Default: today and next 7 days
    const today = new Date().toISOString().split('T')[0];
    const next7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    q = q.gte('scheduled_date', today).lte('scheduled_date', next7);
  }

  if (query.status) q = q.eq('status', query.status);

  const { data, error } = await q;
  if (error) throw new BadRequestError(error.message);
  return data ?? [];
}

export async function updateBookingStatus(
  staffId: string,
  bookingId: string,
  newStatus: 'in_progress' | 'completed' | 'no_show'
) {
  const { data: booking, error } = await supabaseAdmin
    .from('service_bookings')
    .select('status, staff_id')
    .eq('id', bookingId)
    .single();

  if (error || !booking) throw new NotFoundError('Booking');
  if (booking.staff_id !== staffId) throw new ForbiddenError('Not assigned to this booking');

  const allowed = STAFF_ALLOWED_TRANSITIONS[booking.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new BadRequestError(`Cannot transition from '${booking.status}' to '${newStatus}'`);
  }

  const extra: Record<string, unknown> = {};
  if (newStatus === 'completed') extra.completed_at = new Date().toISOString();

  const { data, error: updateErr } = await supabaseAdmin
    .from('service_bookings')
    .update({ status: newStatus, ...extra })
    .eq('id', bookingId)
    .select('id, booking_number, status, completed_at')
    .single();

  if (updateErr || !data) throw new BadRequestError('Status update failed');
  return data;
}

export async function getOwnCommissions(
  staffId: string,
  query: { page?: string; limit?: string; status?: string; startDate?: string; endDate?: string }
) {
  const { page, limit, offset } = parsePage(query);

  let q = supabaseAdmin
    .from('commission_earnings')
    .select(
      'id, service_amount, commission_pct, commission_amount, status, created_at, service_bookings(booking_number, scheduled_date, services(name))',
      { count: 'exact' }
    )
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);
  if (query.startDate) q = q.gte('created_at', query.startDate);
  if (query.endDate) q = q.lte('created_at', query.endDate);

  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getCommissionSummary(staffId: string) {
  const { data: pending } = await supabaseAdmin
    .from('commission_earnings')
    .select('commission_amount')
    .eq('staff_id', staffId)
    .eq('status', 'pending');

  const { data: paid } = await supabaseAdmin
    .from('commission_earnings')
    .select('commission_amount')
    .eq('staff_id', staffId)
    .eq('status', 'paid');

  const sumPending = (pending ?? []).reduce((acc, r) => acc + Number(r.commission_amount), 0);
  const sumPaid = (paid ?? []).reduce((acc, r) => acc + Number(r.commission_amount), 0);

  return { pending: sumPending, paid: sumPaid, total: sumPending + sumPaid };
}

export async function getOwnStaffProfile(staffId: string) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, name, phone, avatar_url, bio, branch_id, created_at, branches(name)')
    .eq('id', staffId)
    .single();

  const { data: staffProfile } = await supabaseAdmin
    .from('staff_profiles')
    .select('salary_type, base_salary, commission_pct, hire_date, mpesa_number, bank_name, bank_account, emergency_contact_name, emergency_contact_phone')
    .eq('id', staffId)
    .maybeSingle();

  return { ...profile, staffProfile: staffProfile ?? null };
}

export async function upsertStaffProfile(
  staffId: string,
  payload: {
    mpesaNumber?: string;
    bankName?: string;
    bankAccount?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
  }
) {
  const { data, error } = await supabaseAdmin
    .from('staff_profiles')
    .upsert(
      {
        id:                       staffId,
        mpesa_number:             payload.mpesaNumber,
        bank_name:                payload.bankName,
        bank_account:             payload.bankAccount,
        emergency_contact_name:   payload.emergencyContactName,
        emergency_contact_phone:  payload.emergencyContactPhone,
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Profile update failed');
  return data;
}

export async function getOwnPerformance(staffId: string) {
  const { data } = await supabaseAdmin
    .from('staff_performance')
    .select('*')
    .eq('staff_id', staffId)
    .maybeSingle();
  return data ?? null;
}
