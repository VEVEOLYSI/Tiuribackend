import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export async function listServices() {
  const { data } = await supabaseAdmin
    .from('services')
    .select('id, name, slug, description, price, duration_minutes, capacity, images, is_featured, created_at')
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('name');
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

export async function getServiceSlots(serviceId: string, date?: string) {
  let query = supabaseAdmin
    .from('service_slots')
    .select('id, slot_date, start_time, end_time, capacity, booked_count, is_blocked, staff_id')
    .eq('service_id', serviceId)
    .eq('is_blocked', false)
    .gte('slot_date', date ?? new Date().toISOString().split('T')[0])
    .order('slot_date')
    .order('start_time');

  const { data } = await query;
  return (data ?? []).filter(
    (s: { capacity: number; booked_count: number }) => s.booked_count < s.capacity
  );
}

export async function createService(payload: {
  name: string; slug: string; description?: string; price: number;
  durationMinutes: number; capacity?: number; images?: unknown[];
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
