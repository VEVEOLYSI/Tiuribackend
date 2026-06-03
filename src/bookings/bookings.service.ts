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
    notes?: string;
    ip?: string;
  }
) {
  const { data: service } = await supabaseAdmin
    .from('services')
    .select('id, name, price, is_active')
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

  const bookingNumber = (await supabaseAdmin.rpc('generate_booking_number')).data as string;

  const { data: booking, error } = await supabaseAdmin
    .from('service_bookings')
    .insert({
      booking_number: bookingNumber,
      user_id: userId,
      service_id: payload.serviceId,
      slot_id: payload.slotId ?? null,
      scheduled_date: payload.scheduledDate,
      scheduled_time: payload.scheduledTime,
      price: service.price,
      notes: payload.notes,
      ip_address: payload.ip,
    })
    .select('id, booking_number')
    .single();

  if (error || !booking) throw new BadRequestError(error?.message ?? 'Booking creation failed');

  bookingsCreatedTotal.inc();

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const { data: profile } = await supabaseAdmin.from('profiles').select('name').eq('id', userId).single();

  if (authUser.user?.email) {
    sendEmail({
      to: [{ email: authUser.user.email, name: profile?.name }],
      ...templates.bookingConfirmed(
        bookingNumber,
        service.name,
        payload.scheduledDate,
        payload.scheduledTime
      ),
    }).catch(() => {});
  }

  return booking;
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
