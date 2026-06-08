import { supabaseAdmin } from '../config/db.js';
import { sendEmail, templates } from '../config/email.js';
import { bookingsCreatedTotal } from '../config/metrics.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

export async function listBookings(userId: string, query: { page?: string; limit?: string; status?: string }) {
  const { page, limit, offset } = parsePage(query);

  let q = supabaseAdmin
    .from('service_bookings')
    .select(
      'id, booking_number, scheduled_date, scheduled_time, status, price, services(name)',
      { count: 'exact' }
    )
    .eq('user_id', userId)
    .order('scheduled_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);

  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getBooking(userId: string, bookingId: string, isAdmin = false) {
  let q = supabaseAdmin
    .from('service_bookings')
    .select(`
      *,
      services(name, duration_minutes),
      service_slots(slot_date, start_time, end_time)
    `)
    .eq('id', bookingId);

  if (!isAdmin) q = q.eq('user_id', userId);

  const { data, error } = await q.single();
  if (error || !data) throw new NotFoundError('Booking');
  return data;
}

export async function createBooking(
  userId: string,
  payload: {
    serviceId: string;
    slotId?: string;
    scheduledDate: string;
    scheduledTime: string;
    staffId?: string;
    notes?: string;
    branchId?: string;
    ip?: string;
  }
) {
  const { data: service } = await supabaseAdmin
    .from('services')
    .select('id, name, price, is_active, deposit_percent')
    .eq('id', payload.serviceId)
    .eq('is_active', true)
    .single();

  if (!service) throw new NotFoundError('Service');

  // Reserve slot
  if (payload.slotId) {
    const { data: slot } = await supabaseAdmin
      .from('service_slots')
      .select('capacity, booked_count, is_blocked')
      .eq('id', payload.slotId)
      .single();

    if (!slot || slot.is_blocked || slot.booked_count >= slot.capacity) {
      throw new BadRequestError('Slot is not available');
    }

    await supabaseAdmin
      .from('service_slots')
      .update({ booked_count: slot.booked_count + 1 })
      .eq('id', payload.slotId);
  }

  const price = Number(service.price);
  const depositPct = Number(service.deposit_percent ?? 0) || 30; // default 30% if not configured
  const depositAmount = Math.round((price * depositPct / 100) * 100) / 100;
  const balanceAmount = Math.round((price - depositAmount) * 100) / 100;

  const bookingNumber = (await supabaseAdmin.rpc('generate_booking_number')).data as string;

  const { data: booking, error } = await supabaseAdmin
    .from('service_bookings')
    .insert({
      booking_number:  bookingNumber,
      user_id:         userId,
      service_id:      payload.serviceId,
      slot_id:         payload.slotId ?? null,
      staff_id:        payload.staffId ?? null,
      branch_id:       payload.branchId ?? null,
      scheduled_date:  payload.scheduledDate,
      scheduled_time:  payload.scheduledTime,
      price,
      deposit_amount:  depositAmount,
      balance_amount:  balanceAmount,
      notes:           payload.notes,
      ip_address:      payload.ip,
    })
    .select('id, booking_number, deposit_amount, balance_amount')
    .single();

  if (error || !booking) throw new BadRequestError(error?.message ?? 'Booking creation failed');

  bookingsCreatedTotal.inc();

  // Confirmation email is sent by payments.service.ts after deposit is paid,
  // not here — booking is still pending at this point.

  return booking;
}

export async function createWalkinBooking(
  actorId: string,
  payload: {
    clientId: string;
    serviceId: string;
    scheduledDate: string;
    scheduledTime: string;
    staffId?: string;
    branchId?: string;
    notes?: string;
  }
) {
  const { data: service } = await supabaseAdmin
    .from('services')
    .select('id, name, price, is_active, deposit_percent')
    .eq('id', payload.serviceId)
    .eq('is_active', true)
    .single();

  if (!service) throw new NotFoundError('Service');

  const price = Number(service.price);
  const bookingNumber = (await supabaseAdmin.rpc('generate_booking_number')).data as string;

  const { data: booking, error } = await supabaseAdmin
    .from('service_bookings')
    .insert({
      booking_number:  bookingNumber,
      user_id:         payload.clientId,
      service_id:      payload.serviceId,
      staff_id:        payload.staffId ?? actorId,
      branch_id:       payload.branchId ?? null,
      scheduled_date:  payload.scheduledDate,
      scheduled_time:  payload.scheduledTime,
      price,
      deposit_amount:  0,
      balance_amount:  price,
      notes:           payload.notes ?? null,
      is_walkin:       true,
      status:          'confirmed',
    })
    .select('id, booking_number, status, is_walkin')
    .single();

  if (error || !booking) throw new BadRequestError(error?.message ?? 'Walk-in booking failed');
  bookingsCreatedTotal.inc();
  return booking;
}

export async function startBooking(actorId: string, bookingId: string) {
  const { data, error } = await supabaseAdmin
    .from('service_bookings')
    .update({ status: 'in_progress', actual_start_time: new Date().toISOString() })
    .eq('id', bookingId)
    .in('status', ['pending', 'confirmed'])
    .select('id, booking_number, status, actual_start_time')
    .single();
  if (error || !data) throw new BadRequestError('Cannot start this booking');
  return data;
}

export async function completeBooking(actorId: string, bookingId: string) {
  const { data, error } = await supabaseAdmin
    .from('service_bookings')
    .update({ status: 'completed', actual_end_time: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('status', 'in_progress')
    .select('id, booking_number, status, actual_end_time')
    .single();
  if (error || !data) throw new BadRequestError('Booking must be in progress before completing');
  return data;
}

export async function assignStaff(actorId: string, bookingId: string, staffId: string) {
  const { data, error } = await supabaseAdmin
    .from('service_bookings')
    .update({ staff_id: staffId })
    .eq('id', bookingId)
    .select('id, booking_number, staff_id, status')
    .single();
  if (error || !data) throw new NotFoundError('Booking');
  return data;
}

export async function cancelBooking(userId: string, bookingId: string, reason?: string) {
  const { data, error } = await supabaseAdmin
    .from('service_bookings')
    .select('status, user_id')
    .eq('id', bookingId)
    .single();

  if (error || !data) throw new NotFoundError('Booking');
  if (data.user_id !== userId) throw new NotFoundError('Booking');
  if (!['pending', 'confirmed'].includes(data.status)) {
    throw new BadRequestError('Booking cannot be cancelled at this stage');
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('service_bookings')
    .update({
      status: 'cancelled',
      cancellation_reason: reason,
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select('id, booking_number, status')
    .single();

  if (updErr || !updated) throw new BadRequestError('Cancel failed');
  return updated;
}
