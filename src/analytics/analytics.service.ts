import { supabaseAdmin } from '../config/db.js';

export async function getRevenueSummary(period: '7d' | '30d' | '90d' | '1y' = '30d') {
  const days = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }[period];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: daily } = await supabaseAdmin
    .from('daily_revenue')
    .select('day, order_count, revenue, avg_order_value')
    .gte('day', since.split('T')[0])
    .order('day');

  const total = (daily ?? []).reduce((acc: number, r: { revenue: number }) => acc + Number(r.revenue), 0);
  const orderCount = (daily ?? []).reduce((acc: number, r: { order_count: number }) => acc + Number(r.order_count), 0);

  return { period, total, orderCount, avgOrderValue: orderCount ? total / orderCount : 0, daily: daily ?? [] };
}

export async function getOrderAnalytics() {
  const { data: byStatus } = await supabaseAdmin
    .from('orders')
    .select('order_status', { count: 'exact' })
    .then(async () => {
      const statuses = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
      const results = await Promise.all(
        statuses.map(async (status) => {
          const { count } = await supabaseAdmin
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('order_status', status);
          return { status, count: count ?? 0 };
        })
      );
      return { data: results };
    });

  const { data: recent } = await supabaseAdmin
    .from('order_summary')
    .select('id, order_number, total_amount, payment_status, order_status, created_at, customer_name, customer_email, item_count')
    .order('created_at', { ascending: false })
    .limit(10);

  return { byStatus: byStatus ?? [], recentOrders: recent ?? [] };
}

export async function getTopProducts(limit = 10) {
  const { data } = await supabaseAdmin
    .from('order_items')
    .select('product_id, product_snapshot, quantity')
    .not('product_id', 'is', null);

  if (!data) return [];

  const aggregated = new Map<string, { name: string; image?: string; totalSold: number; revenue: number }>();
  for (const item of data as Array<{ product_id: string; product_snapshot: { name: string; price: number; image?: string }; quantity: number }>) {
    const existing = aggregated.get(item.product_id) ?? {
      name: item.product_snapshot.name,
      image: item.product_snapshot.image,
      totalSold: 0,
      revenue: 0,
    };
    existing.totalSold += item.quantity;
    existing.revenue += item.quantity * item.product_snapshot.price;
    aggregated.set(item.product_id, existing);
  }

  return Array.from(aggregated.entries())
    .map(([id, stats]) => ({ productId: id, ...stats }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export async function getCustomerAnalytics() {
  const { count: total } = await supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'customer')
    .is('deleted_at', null);

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: newThisMonth } = await supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'customer')
    .gte('created_at', since30d);

  const { count: active } = await supabaseAdmin
    .from('orders')
    .select('user_id', { count: 'exact', head: true })
    .gte('created_at', since30d);

  return { total: total ?? 0, newThisMonth: newThisMonth ?? 0, activeThisMonth: active ?? 0 };
}

export async function getBookingAnalytics(period: '7d' | '30d' | '90d' = '30d') {
  const days = { '7d': 7, '30d': 30, '90d': 90 }[period];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: calendar } = await supabaseAdmin
    .from('booking_calendar')
    .select('*')
    .gte('scheduled_date', since.split('T')[0])
    .order('scheduled_date')
    .order('scheduled_time');

  const byStatus: Record<string, number> = {};
  for (const b of (calendar ?? []) as Array<{ status: string }>) {
    byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
  }

  return { period, total: calendar?.length ?? 0, byStatus, upcoming: calendar ?? [] };
}

export async function getInventoryAlerts() {
  const { data } = await supabaseAdmin
    .from('products')
    .select('id, name, slug, stock, low_stock_threshold')
    .eq('is_active', true)
    .is('deleted_at', null);

  const products = (data ?? []) as Array<{ id: string; name: string; slug: string; stock: number; low_stock_threshold: number }>;
  const lowStock = products.filter((p) => p.stock <= p.low_stock_threshold && p.stock > 0);
  const outOfStock = products.filter((p) => p.stock === 0);

  return { lowStock, outOfStock };
}

// ─── ERP Analytics ────────────────────────────────────────────────────────────

export async function getStaffPerformance(query: { staffId?: string } = {}) {
  let q = supabaseAdmin.from('staff_performance').select('*');
  if (query.staffId) q = q.eq('staff_id', query.staffId);
  const { data } = await q;
  return data ?? [];
}

export async function getPLReport(period: '1m' | '3m' | '6m' | '1y' = '3m') {
  const months = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }[period];
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceStr = since.toISOString().split('T')[0];

  const { data: pl } = await supabaseAdmin
    .from('pl_monthly')
    .select('month, total_revenue, total_expenses, net_profit')
    .gte('month', sinceStr)
    .order('month');

  const rows = pl ?? [];
  const totalRevenue  = rows.reduce((acc, r) => acc + Number(r.total_revenue ?? 0), 0);
  const totalExpenses = rows.reduce((acc, r) => acc + Number(r.total_expenses ?? 0), 0);
  const netProfit     = totalRevenue - totalExpenses;

  return { period, totalRevenue, totalExpenses, netProfit, monthly: rows };
}

export async function getSalonInventoryAlerts() {
  const { data } = await supabaseAdmin
    .from('inventory_items')
    .select('id, name, unit, stock_quantity, low_stock_threshold, inventory_categories(name)')
    .eq('is_active', true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (data ?? []) as any[];

  const lowStock   = items.filter((i) => Number(i.stock_quantity) > 0 && Number(i.stock_quantity) <= Number(i.low_stock_threshold));
  const outOfStock = items.filter((i) => Number(i.stock_quantity) <= 0);

  return { lowStock, outOfStock };
}

export async function getCommissionSummary(period: '7d' | '30d' | '90d' = '30d') {
  const days = { '7d': 7, '30d': 30, '90d': 90 }[period];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabaseAdmin
    .from('commission_earnings')
    .select('staff_id, status, commission_amount, profiles!staff_id(name)')
    .gte('created_at', since);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  const byStaff = new Map<string, { staffId: string; name: string; pending: number; paid: number }>();
  for (const row of rows) {
    const staffId: string = row.staff_id;
    const profArr: { name: string }[] | null = row.profiles;
    const profileName: string = (Array.isArray(profArr) ? profArr[0]?.name : null) ?? 'Unknown';
    const entry = byStaff.get(staffId) ?? { staffId, name: profileName, pending: 0, paid: 0 };
    if (row.status === 'pending') entry.pending += Number(row.commission_amount);
    if (row.status === 'paid')    entry.paid    += Number(row.commission_amount);
    byStaff.set(staffId, entry);
  }

  return { period, staff: Array.from(byStaff.values()) };
}

export async function getDashboardSummary() {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 7) + '-01';

  const [
    { count: todayBookings },
    { count: pendingLeaves },
    { data: lowStockItems },
    { data: upcomingMaintenance },
  ] = await Promise.all([
    supabaseAdmin
      .from('service_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('scheduled_date', today)
      .not('status', 'in', '("cancelled","no_show")'),

    supabaseAdmin
      .from('staff_leaves')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),

    supabaseAdmin
      .from('inventory_items')
      .select('id')
      .eq('is_active', true)
      .lte('stock_quantity', 5),

    supabaseAdmin
      .from('assets')
      .select('id, name, next_service_date')
      .eq('status', 'active')
      .not('next_service_date', 'is', null)
      .lte('next_service_date', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .order('next_service_date'),
  ]);

  return {
    today: {
      bookings: todayBookings ?? 0,
    },
    alerts: {
      pendingLeaves:         pendingLeaves ?? 0,
      lowStockItems:         (lowStockItems ?? []).length,
      assetsNeedingService:  (upcomingMaintenance ?? []).length,
    },
    upcomingMaintenance: upcomingMaintenance ?? [],
  };
}
