import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ConflictError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import type { LeaveType, LeaveStatus } from '../types/index.js';

// ─── Shifts ──────────────────────────────────────────────────────────────────

export async function createShift(
  actorId: string,
  payload: {
    staffId: string;
    shiftDate: string;
    startTime?: string;
    endTime?: string;
    isDayOff?: boolean;
    notes?: string;
    branchId?: string;
  }
) {
  const { data, error } = await supabaseAdmin
    .from('shifts')
    .upsert(
      {
        staff_id:   payload.staffId,
        branch_id:  payload.branchId ?? null,
        shift_date: payload.shiftDate,
        start_time: payload.startTime ?? null,
        end_time:   payload.endTime ?? null,
        is_day_off: payload.isDayOff ?? false,
        notes:      payload.notes ?? null,
        created_by: actorId,
      },
      { onConflict: 'staff_id,shift_date' }
    )
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Shift creation failed');
  return data;
}

export async function listShifts(query: {
  staffId?: string;
  startDate?: string;
  endDate?: string;
  branchId?: string;
  page?: string;
  limit?: string;
}) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('shifts')
    .select('*, profiles!staff_id(name)', { count: 'exact' })
    .order('shift_date')
    .range(offset, offset + limit - 1);
  if (query.staffId) q = q.eq('staff_id', query.staffId);
  if (query.branchId) q = q.eq('branch_id', query.branchId);
  if (query.startDate) q = q.gte('shift_date', query.startDate);
  if (query.endDate) q = q.lte('shift_date', query.endDate);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getOwnShifts(staffId: string, query: { startDate?: string; endDate?: string }) {
  let q = supabaseAdmin
    .from('shifts')
    .select('*')
    .eq('staff_id', staffId)
    .order('shift_date');
  if (query.startDate) q = q.gte('shift_date', query.startDate);
  if (query.endDate) q = q.lte('shift_date', query.endDate);
  const { data } = await q;
  return data ?? [];
}

export async function deleteShift(shiftId: string) {
  const { error } = await supabaseAdmin.from('shifts').delete().eq('id', shiftId);
  if (error) throw new BadRequestError(error.message);
}

// ─── Leave ───────────────────────────────────────────────────────────────────

export async function requestLeave(
  staffId: string,
  payload: { leaveType: LeaveType; startDate: string; endDate: string; reason?: string }
) {
  if (new Date(payload.startDate) > new Date(payload.endDate)) {
    throw new BadRequestError('Start date must be before end date');
  }

  // Prevent duplicate pending leave overlapping same dates
  const { count } = await supabaseAdmin
    .from('staff_leaves')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', staffId)
    .eq('status', 'pending')
    .lte('start_date', payload.endDate)
    .gte('end_date', payload.startDate);
  if ((count ?? 0) > 0) throw new ConflictError('You already have a pending leave request overlapping those dates');

  const { data, error } = await supabaseAdmin
    .from('staff_leaves')
    .insert({
      staff_id:   staffId,
      leave_type: payload.leaveType,
      start_date: payload.startDate,
      end_date:   payload.endDate,
      reason:     payload.reason ?? null,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Leave request failed');
  return data;
}

export async function listLeaves(query: {
  staffId?: string;
  status?: string;
  page?: string;
  limit?: string;
}) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('staff_leaves')
    .select('*, profiles!staff_id(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.staffId) q = q.eq('staff_id', query.staffId);
  if (query.status) q = q.eq('status', query.status);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getOwnLeaves(staffId: string, query: { status?: string; page?: string; limit?: string }) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('staff_leaves')
    .select('*', { count: 'exact' })
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.status) q = q.eq('status', query.status);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function approveLeave(
  actorId: string,
  leaveId: string,
  approved: boolean,
  rejectionReason?: string
) {
  const { data: existing } = await supabaseAdmin
    .from('staff_leaves')
    .select('status')
    .eq('id', leaveId)
    .single();
  if (!existing) throw new NotFoundError('Leave request');
  if (existing.status !== 'pending') throw new BadRequestError('Leave request is no longer pending');

  const newStatus: LeaveStatus = approved ? 'approved' : 'rejected';
  const { data, error } = await supabaseAdmin
    .from('staff_leaves')
    .update({
      status:           newStatus,
      approved_by:      actorId,
      approved_at:      new Date().toISOString(),
      rejection_reason: approved ? null : (rejectionReason ?? null),
    })
    .eq('id', leaveId)
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError('Approval failed');

  // Block out the shift days for approved leaves
  if (approved && data) {
    const start = new Date(data.start_date);
    const end   = new Date(data.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      await supabaseAdmin
        .from('shifts')
        .upsert(
          { staff_id: data.staff_id, shift_date: dateStr, is_day_off: true, created_by: actorId },
          { onConflict: 'staff_id,shift_date' }
        );
    }
  }

  return data;
}

export async function cancelLeave(staffId: string, leaveId: string) {
  const { data: existing } = await supabaseAdmin
    .from('staff_leaves')
    .select('staff_id, status')
    .eq('id', leaveId)
    .single();
  if (!existing) throw new NotFoundError('Leave request');
  if (existing.staff_id !== staffId) throw new BadRequestError('Not your leave request');
  if (existing.status !== 'pending') throw new BadRequestError('Only pending requests can be cancelled');

  const { data, error } = await supabaseAdmin
    .from('staff_leaves')
    .update({ status: 'cancelled' })
    .eq('id', leaveId)
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError('Cancel failed');
  return data;
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export async function clockIn(staffId: string, branchId?: string, recordedBy?: string) {
  const today = new Date().toISOString().split('T')[0];

  const { data: existing } = await supabaseAdmin
    .from('attendance_records')
    .select('id, clock_in, clock_out')
    .eq('staff_id', staffId)
    .eq('record_date', today)
    .maybeSingle();

  if (existing?.clock_in && !existing?.clock_out) {
    throw new ConflictError('Already clocked in for today');
  }

  if (existing) {
    // Re-clock in (rare: forgot to clock out yesterday)
    const { data, error } = await supabaseAdmin
      .from('attendance_records')
      .update({ clock_in: new Date().toISOString(), clock_out: null })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestError('Clock-in failed');
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from('attendance_records')
    .insert({
      staff_id:    staffId,
      branch_id:   branchId ?? null,
      record_date: today,
      clock_in:    new Date().toISOString(),
      recorded_by: recordedBy ?? staffId,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Clock-in failed');
  return data;
}

export async function clockOut(staffId: string, note?: string, recordedBy?: string) {
  const today = new Date().toISOString().split('T')[0];
  const now   = new Date();

  const { data: existing } = await supabaseAdmin
    .from('attendance_records')
    .select('id, clock_in, clock_out')
    .eq('staff_id', staffId)
    .eq('record_date', today)
    .maybeSingle();

  if (!existing?.clock_in) throw new BadRequestError('Not clocked in today');
  if (existing.clock_out)   throw new ConflictError('Already clocked out today');

  // Detect early clock-out by comparing against business end time
  const { data: settings } = await supabaseAdmin
    .from('business_settings')
    .select('business_end_time')
    .limit(1)
    .maybeSingle();

  const bizEnd = (settings?.business_end_time as string | null) ?? '18:00';
  const [bh, bm] = bizEnd.split(':').map(Number);
  const bizEndMs = new Date(now);
  bizEndMs.setHours(bh, bm, 0, 0);
  const isEarly = now < bizEndMs;

  if (isEarly && !note) {
    throw new BadRequestError('Please provide a reason — you are clocking out before business hours end');
  }

  const { data, error } = await supabaseAdmin
    .from('attendance_records')
    .update({
      clock_out:   now.toISOString(),
      notes:       note ?? null,
      recorded_by: recordedBy ?? staffId,
    })
    .eq('id', existing.id)
    .select('*')
    .single();

  if (error || !data) throw new BadRequestError('Clock-out failed');

  // Notify all admins when a staff member leaves early
  if (isEarly) {
    const { data: staffProfile } = await supabaseAdmin
      .from('profiles')
      .select('name')
      .eq('id', staffId)
      .single();

    const staffName = (staffProfile as { name: string } | null)?.name ?? 'A staff member';
    const clockOutTime = now.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });

    const { data: admins } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .eq('is_active', true)
      .is('deleted_at', null);

    if (admins && admins.length > 0) {
      const notifications = (admins as { id: string }[]).map((a) => ({
        user_id: a.id,
        type:    'system',
        title:   'Early Clock-Out Alert',
        body:    `${staffName} clocked out at ${clockOutTime} (before ${bizEnd}). Reason: ${note}`,
      }));
      await supabaseAdmin.from('notifications').insert(notifications).throwOnError();
    }
  }

  return data;
}

export async function listAttendance(query: {
  staffId?: string;
  startDate?: string;
  endDate?: string;
  branchId?: string;
  page?: string;
  limit?: string;
}) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('attendance_records')
    .select('*, profiles!staff_id(name)', { count: 'exact' })
    .order('record_date', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.staffId) q = q.eq('staff_id', query.staffId);
  if (query.branchId) q = q.eq('branch_id', query.branchId);
  if (query.startDate) q = q.gte('record_date', query.startDate);
  if (query.endDate) q = q.lte('record_date', query.endDate);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getOwnAttendance(staffId: string, query: { startDate?: string; endDate?: string; page?: string; limit?: string }) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('attendance_records')
    .select('*', { count: 'exact' })
    .eq('staff_id', staffId)
    .order('record_date', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.startDate) q = q.gte('record_date', query.startDate);
  if (query.endDate) q = q.lte('record_date', query.endDate);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function adminClockIn(staffId: string, branchId?: string, actorId?: string, notes?: string) {
  return clockIn(staffId, branchId, actorId);
}

export async function adminClockOut(staffId: string, actorId?: string, note?: string) {
  return clockOut(staffId, note, actorId);
}
