import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

// ─── Business Settings ────────────────────────────────────────────────────────

const SETTINGS_DEFAULTS = {
  business_start_time:   '08:00',
  business_end_time:     '18:00',
  slot_interval_minutes: 30,
  working_days:          [1, 2, 3, 4, 5, 6],
  staff_orders_enabled:  true,
};

export async function getBusinessSettings() {
  const { data } = await supabaseAdmin
    .from('business_settings')
    .select('*')
    .limit(1)
    .maybeSingle();
  return data ?? SETTINGS_DEFAULTS;
}

export async function updateBusinessSettings(payload: {
  businessStartTime?: string;
  businessEndTime?: string;
  slotIntervalMinutes?: number;
  workingDays?: number[];
  staffOrdersEnabled?: boolean;
}) {
  const { data: existing } = await supabaseAdmin
    .from('business_settings')
    .select('id')
    .limit(1)
    .maybeSingle();

  const updates: Record<string, unknown> = {};
  if (payload.businessStartTime   !== undefined) updates.business_start_time   = payload.businessStartTime;
  if (payload.businessEndTime     !== undefined) updates.business_end_time     = payload.businessEndTime;
  if (payload.slotIntervalMinutes !== undefined) updates.slot_interval_minutes = payload.slotIntervalMinutes;
  if (payload.workingDays         !== undefined) updates.working_days          = payload.workingDays;
  if (payload.staffOrdersEnabled  !== undefined) updates.staff_orders_enabled  = payload.staffOrdersEnabled;

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('business_settings')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();
    if (error || !data) throw new BadRequestError(error?.message ?? 'Update failed');
    return data;
  }

  // Insert if somehow missing
  const { data, error } = await supabaseAdmin
    .from('business_settings')
    .insert({
      business_start_time:   payload.businessStartTime   ?? '08:00',
      business_end_time:     payload.businessEndTime     ?? '18:00',
      slot_interval_minutes: payload.slotIntervalMinutes ?? 30,
      working_days:          payload.workingDays         ?? [1,2,3,4,5,6],
    })
    .select()
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');
  return data;
}

// ─── Staff Schedules ──────────────────────────────────────────────────────────

export async function listStaffSchedules(staffId?: string) {
  let q = supabaseAdmin
    .from('staff_schedules')
    .select(`
      id, staff_id, day_of_week, start_time, end_time, is_active,
      profiles(id, name, avatar_url)
    `)
    .order('staff_id')
    .order('day_of_week');

  if (staffId) q = q.eq('staff_id', staffId);

  const { data } = await q;
  return data ?? [];
}

export async function upsertStaffSchedule(
  staffId: string,
  dayOfWeek: number,
  payload: { startTime: string; endTime: string; isActive?: boolean }
) {
  const { data, error } = await supabaseAdmin
    .from('staff_schedules')
    .upsert(
      {
        staff_id:    staffId,
        day_of_week: dayOfWeek,
        start_time:  payload.startTime,
        end_time:    payload.endTime,
        is_active:   payload.isActive ?? true,
      },
      { onConflict: 'staff_id,day_of_week' }
    )
    .select()
    .single();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Schedule upsert failed');
  return data;
}

export async function deleteStaffScheduleDay(staffId: string, dayOfWeek: number) {
  const { error } = await supabaseAdmin
    .from('staff_schedules')
    .delete()
    .eq('staff_id', staffId)
    .eq('day_of_week', dayOfWeek);

  if (error) throw new NotFoundError('Schedule entry');
}

export async function replaceStaffWeeklySchedule(
  staffId: string,
  days: { dayOfWeek: number; startTime: string; endTime: string }[]
) {
  // Delete all existing days for this staff member then insert the new set
  await supabaseAdmin.from('staff_schedules').delete().eq('staff_id', staffId);

  if (days.length === 0) return [];

  const rows = days.map((d) => ({
    staff_id:    staffId,
    day_of_week: d.dayOfWeek,
    start_time:  d.startTime,
    end_time:    d.endTime,
    is_active:   true,
  }));

  const { data, error } = await supabaseAdmin
    .from('staff_schedules')
    .insert(rows)
    .select();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Schedule replace failed');
  return data;
}

// ─── All staff list (used by admin scheduling page) ───────────────────────────

export async function listStaffProfiles() {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, name, avatar_url, is_active')
    .eq('role', 'staff')
    .is('deleted_at', null)
    .order('name');
  return data ?? [];
}
