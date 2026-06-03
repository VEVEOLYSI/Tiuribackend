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
