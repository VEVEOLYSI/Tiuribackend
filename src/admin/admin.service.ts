import { supabaseAdmin } from '../config/db.js';
import { writeAuditLog } from '../utils/audit.js';
import { env } from '../config/env.js';
import { sendEmail, templates } from '../config/email.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import type { UserRole, OrderStatus, BookingStatus } from '../types/index.js';

// ─── Stats ────────────────────────────────────────────────────────────────────

export async function getAdminStats() {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 7) + '-01';

  const [todayRevenue, monthRevenue, todayOrders, pendingOrders, activeBookings, totalCustomers] =
    await Promise.all([
      supabaseAdmin.from('orders').select('total_amount').eq('payment_status', 'paid').gte('created_at', today + 'T00:00:00').lt('created_at', today + 'T23:59:59'),
      supabaseAdmin.from('orders').select('total_amount').eq('payment_status', 'paid').gte('created_at', monthStart),
      supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', today + 'T00:00:00'),
      supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('order_status', 'pending'),
      supabaseAdmin.from('service_bookings').select('id', { count: 'exact', head: true }).not('status', 'in', '("cancelled","completed","no_show")'),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'customer').is('deleted_at', null),
    ]);

  const sumRevenue = (rows: { total_amount: number }[] | null) =>
    (rows ?? []).reduce((s, r) => s + Number(r.total_amount), 0);

  return {
    revenue_today:    sumRevenue(todayRevenue.data as { total_amount: number }[] | null),
    revenue_month:    sumRevenue(monthRevenue.data as { total_amount: number }[] | null),
    orders_today:     todayOrders.count ?? 0,
    pending_orders:   pendingOrders.count ?? 0,
    active_bookings:  activeBookings.count ?? 0,
    total_customers:  totalCustomers.count ?? 0,
  };
}

export async function getStaffStats() {
  const today = new Date().toISOString().split('T')[0];
  const [ordersToday, activeBookings, pendingOrders] = await Promise.all([
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', today + 'T00:00:00'),
    supabaseAdmin.from('service_bookings').select('id', { count: 'exact', head: true }).not('status', 'in', '("cancelled","completed","no_show")'),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('order_status', 'pending'),
  ]);
  return {
    orders_today:    ordersToday.count ?? 0,
    active_bookings: activeBookings.count ?? 0,
    pending_orders:  pendingOrders.count ?? 0,
  };
}

// ─── Staff Invite (admin-created accounts skip email verification) ───────────

export async function inviteStaff(
  actorId: string,
  payload: { email: string; name: string; role?: 'staff' | 'admin'; branchId?: string }
) {
  const role = payload.role ?? 'staff';

  // Admin-created accounts are pre-confirmed (admin vouches for the person).
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email:         payload.email,
    email_confirm: true,
    user_metadata: { name: payload.name },
  });

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      throw new BadRequestError('Email already in use');
    }
    throw new BadRequestError(error.message);
  }

  const userId = data.user!.id;

  // Set role and branch immediately
  await supabaseAdmin
    .from('profiles')
    .update({ role, name: payload.name, branch_id: payload.branchId ?? null })
    .eq('id', userId);

  // Generate a one-time magic link so they can set their password on first login
  const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
    type:    'magiclink',
    email:   payload.email,
    options: { redirectTo: `${env.FRONTEND_URL}/set-password` },
  });

  if (linkData?.properties?.action_link) {
    sendEmail({
      to: [{ email: payload.email, name: payload.name }],
      subject: `You've been invited to join Tiuri — ${payload.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h1 style="color:#1a1a1a">You've been invited!</h1>
          <p>Hi ${payload.name},</p>
          <p>An admin has created a <strong>${role}</strong> account for you at Tiuri Nails &amp; Wigs Parlour.</p>
          <p>Click the button below to log in and set your password:</p>
          <a href="${linkData.properties.action_link}"
             style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:4px;margin:16px 0">
            Accept Invitation
          </a>
          <p style="color:#666;font-size:13px">This link expires in 24 hours.</p>
        </div>`,
    }).catch(() => {});
  }

  await writeAuditLog({
    actorId,
    actorRole: 'admin',
    action:    'staff.invite',
    entityType: 'profiles',
    entityId:  userId,
    newValue:  { email: payload.email, role },
  });

  return { userId, email: payload.email, role };
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function listUsers(query: { page?: string; limit?: string; role?: string; search?: string }) {
  const { page, limit, offset } = parsePage(query);

  let q = supabaseAdmin
    .from('profiles')
    .select('id, name, phone, role, is_active, last_login_at, created_at', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.role) q = q.eq('role', query.role);
  if (query.search) q = q.ilike('name', `%${query.search}%`);

  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function updateUserRole(actorId: string, userId: string, role: UserRole, ip?: string) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select('id, name, role')
    .single();

  if (error || !data) throw new NotFoundError('User');

  await writeAuditLog({ actorId, actorRole: 'admin', action: 'user.role_change', entityType: 'profiles', entityId: userId, newValue: { role }, ipAddress: ip });
  return data;
}

export async function toggleUserBan(actorId: string, userId: string, ban: boolean, ip?: string) {
  if (userId === actorId) throw new BadRequestError('Cannot ban yourself');

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ is_active: !ban })
    .eq('id', userId)
    .select('id, name, is_active')
    .single();

  if (error || !data) throw new NotFoundError('User');

  await writeAuditLog({ actorId, actorRole: 'admin', action: ban ? 'user.ban' : 'user.unban', entityType: 'profiles', entityId: userId, ipAddress: ip });
  return data;
}

// ─── Orders (admin view) ─────────────────────────────────────────────────────

export async function listAllOrders(query: { page?: string; limit?: string; status?: string; paymentStatus?: string }) {
  const { page, limit, offset } = parsePage(query);

  let q = supabaseAdmin
    .from('order_summary')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('order_status', query.status);
  if (query.paymentStatus) q = q.eq('payment_status', query.paymentStatus);

  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function updateOrderStatus(
  actorId: string,
  orderId: string,
  status: OrderStatus,
  ip?: string
) {
  const { data: before } = await supabaseAdmin.from('orders').select('order_status, user_id').eq('id', orderId).single();
  if (!before) throw new NotFoundError('Order');

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update({ order_status: status })
    .eq('id', orderId)
    .select('id, order_number, order_status')
    .single();

  if (error || !data) throw new BadRequestError('Update failed');

  await writeAuditLog({ actorId, actorRole: 'admin', action: 'order.status_change', entityType: 'orders', entityId: orderId, oldValue: { status: before.order_status }, newValue: { status }, ipAddress: ip });

  // Notify customer
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(before.user_id);
  if (authUser.user?.email) {
    sendEmail({
      to: [{ email: authUser.user.email }],
      ...templates.orderStatusUpdate(data.order_number, status),
    }).catch(() => {});
  }

  return data;
}

// ─── Bookings (admin view) ───────────────────────────────────────────────────

export async function listAllBookings(query: { page?: string; limit?: string; status?: string; date?: string }) {
  const { page, limit, offset } = parsePage(query);

  let q = supabaseAdmin
    .from('booking_calendar')
    .select('*', { count: 'exact' })
    .order('scheduled_date')
    .order('scheduled_time')
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);
  if (query.date) q = q.eq('scheduled_date', query.date);

  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function updateBookingStatus(actorId: string, bookingId: string, status: BookingStatus, ip?: string) {
  const { data, error } = await supabaseAdmin
    .from('service_bookings')
    .update({ status })
    .eq('id', bookingId)
    .select('id, booking_number, status')
    .single();

  if (error || !data) throw new NotFoundError('Booking');
  await writeAuditLog({ actorId, actorRole: 'admin', action: 'booking.status_change', entityType: 'service_bookings', entityId: bookingId, newValue: { status }, ipAddress: ip });
  return data;
}

// ─── Reviews (admin moderation) ──────────────────────────────────────────────

export async function listPendingReviews(query: { page?: string; limit?: string }) {
  const { page, limit, offset } = parsePage(query);
  const { data, count } = await supabaseAdmin
    .from('reviews')
    .select('id, rating, title, comment, target_type, product_id, service_id, created_at, profiles(name)', { count: 'exact' })
    .eq('is_approved', false)
    .is('deleted_at', null)
    .order('created_at')
    .range(offset, offset + limit - 1);
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function approveReview(actorId: string, reviewId: string, approve: boolean, adminResponse?: string) {
  const { data, error } = await supabaseAdmin
    .from('reviews')
    .update({
      is_approved: approve,
      ...(adminResponse && { admin_response: adminResponse, admin_responded_at: new Date().toISOString() }),
    })
    .eq('id', reviewId)
    .select('id, is_approved')
    .single();

  if (error || !data) throw new NotFoundError('Review');
  await writeAuditLog({ actorId, actorRole: 'admin', action: approve ? 'review.approve' : 'review.reject', entityType: 'reviews', entityId: reviewId });
  return data;
}

// ─── Audit logs ──────────────────────────────────────────────────────────────

export async function listAuditLogs(query: { page?: string; limit?: string; action?: string; actorId?: string }) {
  const { page, limit, offset } = parsePage(query);

  let q = supabaseAdmin
    .from('audit_logs')
    .select('id, actor_id, actor_role, action, entity_type, entity_id, ip_address, created_at, profiles(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.action) q = q.ilike('action', `%${query.action}%`);
  if (query.actorId) q = q.eq('actor_id', query.actorId);

  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
