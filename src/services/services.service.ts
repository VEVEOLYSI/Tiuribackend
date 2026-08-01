import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export async function listServices(category?: string) {
  let query = supabaseAdmin
    .from('services')
    .select('id, name, slug, description, price, duration_minutes, capacity, images, is_featured, category, video_url, created_at')
    .eq('is_active', true)
    .is('deleted_at', null);

  if (category) {
    query = query.eq('category', category);
  }

  const { data } = await query.order('name');
  return data ?? [];
}

export async function getServiceBySlug(slug: string) {
  const { data, error } = await supabaseAdmin
    .from('services')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .is('deleted_at', null)
    .single();
  if (error || !data) throw new NotFoundError('Service');
  return data;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export async function getServiceSlots(serviceId: string, date?: string) {
  if (!date) return [];

  // ── 1. Load the service ───────────────────────────────────────────────────
  const { data: service } = await supabaseAdmin
    .from('services')
    .select('id, duration_minutes, buffer_minutes')
    .eq('id', serviceId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .single();

  if (!service) throw new NotFoundError('Service');

  const totalDuration: number =
    (service.duration_minutes as number) + ((service.buffer_minutes as number) || 0);

  // ── 2. Business settings ──────────────────────────────────────────────────
  const { data: settings } = await supabaseAdmin
    .from('business_settings')
    .select('business_start_time, business_end_time, slot_interval_minutes, working_days')
    .limit(1)
    .maybeSingle();

  const bizStart: string    = (settings?.business_start_time as string)  ?? '08:00';
  const bizEnd: string      = (settings?.business_end_time   as string)  ?? '18:00';
  const interval: number    = (settings?.slot_interval_minutes as number) ?? 30;
  const workingDays: number[] = (settings?.working_days as number[])     ?? [1,2,3,4,5,6];

  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  if (!workingDays.includes(dayOfWeek)) return [];

  // ── 3. Active staff members ───────────────────────────────────────────────
  const { data: staffList } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('role', 'staff')
    .eq('is_active', true)
    .is('deleted_at', null);

  const staffIds = (staffList ?? []).map((s: { id: string }) => s.id);

  // ── 4. Build per-staff working windows ────────────────────────────────────
  // Priority: per-date shift > weekly schedule > business defaults

  const [{ data: schedules }, { data: shifts }, { data: leaves }] = await Promise.all([
    staffIds.length
      ? supabaseAdmin
          .from('staff_schedules')
          .select('staff_id, start_time, end_time')
          .in('staff_id', staffIds)
          .eq('day_of_week', dayOfWeek)
          .eq('is_active', true)
      : Promise.resolve({ data: [] }),

    staffIds.length
      ? supabaseAdmin
          .from('shifts')
          .select('staff_id, start_time, end_time, is_day_off')
          .in('staff_id', staffIds)
          .eq('shift_date', date)
      : Promise.resolve({ data: [] }),

    staffIds.length
      ? supabaseAdmin
          .from('staff_leaves')
          .select('staff_id')
          .in('staff_id', staffIds)
          .eq('status', 'approved')
          .lte('start_date', date)
          .gte('end_date', date)
      : Promise.resolve({ data: [] }),
  ]);

  type WorkWindow = { staffId: string; startMin: number; endMin: number };
  const onLeave = new Set((leaves ?? []).map((l: { staff_id: string }) => l.staff_id));
  const workWindows: WorkWindow[] = [];

  if (staffIds.length === 0) {
    // No staff configured → use business hours as a single "virtual" window
    workWindows.push({ staffId: '__business__', startMin: timeToMinutes(bizStart), endMin: timeToMinutes(bizEnd) });
  } else {
    for (const staffId of staffIds) {
      if (onLeave.has(staffId)) continue;

      const shift = (shifts ?? []).find((s: { staff_id: string }) => s.staff_id === staffId);
      if (shift) {
        if ((shift as { is_day_off: boolean }).is_day_off) continue;
        const s = shift as { start_time: string | null; end_time: string | null };
        if (s.start_time && s.end_time) {
          workWindows.push({ staffId, startMin: timeToMinutes(s.start_time), endMin: timeToMinutes(s.end_time) });
        }
        continue;
      }

      const sched = (schedules ?? []).find((s: { staff_id: string }) => s.staff_id === staffId);
      if (sched) {
        const sc = sched as { start_time: string; end_time: string };
        workWindows.push({ staffId, startMin: timeToMinutes(sc.start_time), endMin: timeToMinutes(sc.end_time) });
      } else {
        // No schedule → falls back to business hours
        workWindows.push({ staffId, startMin: timeToMinutes(bizStart), endMin: timeToMinutes(bizEnd) });
      }
    }
  }

  if (workWindows.length === 0) return [];

  // ── 5. Existing bookings for this date ────────────────────────────────────
  const activeStaffIds = workWindows.map((w) => w.staffId).filter((id) => id !== '__business__');

  const { data: existingBookings } = activeStaffIds.length
    ? await supabaseAdmin
        .from('service_bookings')
        .select('staff_id, scheduled_time, actual_end_time, services(duration_minutes, buffer_minutes)')
        .in('staff_id', activeStaffIds)
        .eq('scheduled_date', date)
        .not('status', 'in', '("cancelled","no_show")')
    : { data: [] };

  type Interval = { start: number; end: number };
  const staffBusy = new Map<string, Interval[]>();
  for (const bk of existingBookings ?? []) {
    const b = bk as unknown as {
      staff_id: string;
      scheduled_time: string;
      actual_end_time: string | null;
      services: { duration_minutes: number; buffer_minutes: number } | null;
    };
    if (!b.staff_id) continue;
    const startMin = timeToMinutes(b.scheduled_time);
    let endMin: number;
    if (b.actual_end_time) {
      // Technician already finished — use real end time (may be early or late)
      const t = new Date(b.actual_end_time);
      endMin = t.getHours() * 60 + t.getMinutes();
    } else {
      const dur = (b.services?.duration_minutes ?? 60) + (b.services?.buffer_minutes ?? 0);
      endMin = startMin + dur;
    }
    const arr = staffBusy.get(b.staff_id) ?? [];
    arr.push({ start: startMin, end: endMin });
    staffBusy.set(b.staff_id, arr);
  }

  // ── 6. Generate available slots ───────────────────────────────────────────
  const bizStartMin = timeToMinutes(bizStart);
  const bizEndMin   = timeToMinutes(bizEnd);
  const available: string[] = [];

  for (let slot = bizStartMin; slot + totalDuration <= bizEndMin; slot += interval) {
    const slotEnd = slot + totalDuration;

    const free = workWindows.some((w) => {
      if (slot < w.startMin || slotEnd > w.endMin) return false;
      if (w.staffId === '__business__') return true;
      return !(staffBusy.get(w.staffId) ?? []).some(
        (b) => slot < b.end && slotEnd > b.start
      );
    });

    if (free) available.push(minutesToTime(slot));
  }

  return available.map((startTime) => ({
    id: null,
    slot_date: date,
    start_time: startTime,
    end_time: minutesToTime(timeToMinutes(startTime) + totalDuration),
    capacity: workWindows.length,
    booked_count: 0,
  }));
}

export async function createService(payload: {
  name: string; slug: string; description?: string; price: number;
  durationMinutes: number; capacity?: number; images?: unknown[];
  category?: string; videoUrl?: string | null;
  isFeatured?: boolean; metaTitle?: string; metaDescription?: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('services')
    .insert({
      name: payload.name,
      slug: payload.slug,
      description: payload.description,
      price: payload.price,
      duration_minutes: payload.durationMinutes,
      capacity: payload.capacity ?? 1,
      images: payload.images ?? [],
      category: payload.category ?? null,
      video_url: payload.videoUrl ?? null,
      is_featured: payload.isFeatured ?? false,
      meta_title: payload.metaTitle,
      meta_description: payload.metaDescription,
    })
    .select()
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');
  return data;
}

export async function updateService(id: string, payload: Partial<{
  name: string; slug: string; description: string; price: number;
  durationMinutes: number; capacity: number; images: unknown[];
  category: string; videoUrl: string | null;
  isActive: boolean; isFeatured: boolean;
}>) {
  const updates: Record<string, unknown> = {};
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.slug !== undefined) updates.slug = payload.slug;
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.price !== undefined) updates.price = payload.price;
  if (payload.durationMinutes !== undefined) updates.duration_minutes = payload.durationMinutes;
  if (payload.capacity !== undefined) updates.capacity = payload.capacity;
  if (payload.images !== undefined) updates.images = payload.images;
  if (payload.category !== undefined) updates.category = payload.category;
  if (payload.videoUrl !== undefined) updates.video_url = payload.videoUrl;
  if (payload.isActive !== undefined) updates.is_active = payload.isActive;
  if (payload.isFeatured !== undefined) updates.is_featured = payload.isFeatured;

  const { data, error } = await supabaseAdmin
    .from('services')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();
  if (error || !data) throw new NotFoundError('Service');
  return data;
}

export async function deleteService(id: string) {
  const { error } = await supabaseAdmin
    .from('services')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw new NotFoundError('Service');
}

export async function createSlot(serviceId: string, payload: {
  staffId?: string; slotDate: string; startTime: string; endTime: string; capacity?: number;
}) {
  const { data, error } = await supabaseAdmin
    .from('service_slots')
    .insert({
      service_id: serviceId,
      staff_id: payload.staffId,
      slot_date: payload.slotDate,
      start_time: payload.startTime,
      end_time: payload.endTime,
      capacity: payload.capacity ?? 1,
    })
    .select()
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Slot create failed');
  return data;
}
