import { supabaseAdmin } from '../config/db.js';
import { sendEmail, templates } from '../config/email.js';
import { ordersCreatedTotal } from '../config/metrics.js';
import { NotFoundError, BadRequestError, UnprocessableError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import { writeAuditLog } from '../utils/audit.js';

export async function listOrders(userId: string, query: { page?: string; limit?: string; status?: string }) {
  const { page, limit, offset } = parsePage(query);

  let q = supabaseAdmin
    .from('orders')
    .select('id, order_number, total_amount, payment_status, order_status, created_at', {
      count: 'exact',
    })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('order_status', query.status);

  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getOrder(userId: string, orderId: string, isAdmin = false) {
  let q = supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items(id, product_id, variant_id, product_snapshot, quantity, unit_price, total_price),
      addresses(street, city, county, country),
      discount_codes(code, type, value)
    `)
    .eq('id', orderId);

  if (!isAdmin) q = q.eq('user_id', userId);

  const { data, error } = await q.single();
  if (error || !data) throw new NotFoundError('Order');
  return data;
}

export async function createOrder(
  userId: string,
  payload: {
    addressId?: string;
    discountCode?: string;
    shippingAmount?: number;
    notes?: string;
    idempotencyKey?: string;
    ip?: string;
    items: Array<{
      productId: string;
      variantId?: string;
      quantity: number;
    }>;
  }
) {
  // Check idempotency
  if (payload.idempotencyKey) {
    const { data: existing } = await supabaseAdmin
      .from('orders')
      .select('id, order_number')
      .eq('idempotency_key', payload.idempotencyKey)
      .maybeSingle();
    if (existing) return existing;
  }

  // Validate and price each item
  let subtotal = 0;
  const lineItems: Array<{
    productId: string; variantId?: string; quantity: number;
    unitPrice: number; snapshot: Record<string, unknown>;
  }> = [];

  for (const item of payload.items) {
    const { data: product, error } = await supabaseAdmin
      .from('products')
      .select('id, name, sku, price, images, variants, stock')
      .eq('id', item.productId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .single();

    if (error || !product) throw new UnprocessableError(`Product ${item.productId} not found`);
    if (product.stock < item.quantity) {
      throw new UnprocessableError(`Insufficient stock for ${product.name}`);
    }

    let unitPrice: number = product.price;
    if (item.variantId) {
      const variant = (product.variants as Array<{ id: string; price_modifier?: number }>).find(
        (v) => v.id === item.variantId
      );
      if (variant?.price_modifier) unitPrice += variant.price_modifier;
    }

    subtotal += unitPrice * item.quantity;
    lineItems.push({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      unitPrice,
      snapshot: {
        name: product.name,
        sku: product.sku,
        price: unitPrice,
        image: (product.images as Array<{ url: string }>)[0]?.url,
        variantId: item.variantId,
      },
    });
  }

  // Resolve discount
  let discountAmount = 0;
  let discountCodeId: string | null = null;
  if (payload.discountCode) {
    const { data: dc } = await supabaseAdmin
      .from('discount_codes')
      .select('id, type, value, min_order_amount, max_discount_cap, max_uses, used_count, max_uses_per_user')
      .eq('code', payload.discountCode.toUpperCase())
      .eq('is_active', true)
      .single();

    if (!dc) throw new BadRequestError('Invalid discount code');
    if (dc.min_order_amount && subtotal < dc.min_order_amount) {
      throw new BadRequestError(`Minimum order amount is KES ${dc.min_order_amount}`);
    }
    if (dc.max_uses && dc.used_count >= dc.max_uses) throw new BadRequestError('Discount code exhausted');

    const { count: userUseCount } = await supabaseAdmin
      .from('discount_code_uses')
      .select('id', { count: 'exact', head: true })
      .eq('discount_code_id', dc.id)
      .eq('user_id', userId);
    if ((userUseCount ?? 0) >= dc.max_uses_per_user) {
      throw new BadRequestError('You have already used this discount code');
    }

    discountAmount =
      dc.type === 'percent'
        ? Math.min(subtotal * (dc.value / 100), dc.max_discount_cap ?? Infinity)
        : dc.value;
    discountCodeId = dc.id;
  }

  const totalAmount = Math.max(0, subtotal - discountAmount + (payload.shippingAmount ?? 0));

  const orderNumber = (
    await supabaseAdmin.rpc('generate_order_number')
  ).data as string;

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .insert({
      order_number: orderNumber,
      user_id: userId,
      address_id: payload.addressId ?? null,
      discount_code_id: discountCodeId,
      subtotal,
      discount_amount: discountAmount,
      shipping_amount: payload.shippingAmount ?? 0,
      total_amount: totalAmount,
      notes: payload.notes,
      ip_address: payload.ip,
      idempotency_key: payload.idempotencyKey ?? null,
    })
    .select('id, order_number')
    .single();

  if (orderErr || !order) throw new BadRequestError(orderErr?.message ?? 'Order creation failed');

  // Insert order items & reserve stock atomically
  for (const item of lineItems) {
    const reserved = await supabaseAdmin.rpc('reserve_product_stock', {
      p_product_id: item.productId,
      p_quantity: item.quantity,
    });
    if (!reserved.data) {
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      throw new UnprocessableError(`Stock reservation failed for a product`);
    }

    await supabaseAdmin.from('order_items').insert({
      order_id: order.id,
      product_id: item.productId,
      variant_id: item.variantId ?? null,
      product_snapshot: item.snapshot,
      quantity: item.quantity,
      unit_price: item.unitPrice,
    });
  }

  // Increment discount code usage atomically via raw SQL
  if (discountCodeId) {
    await supabaseAdmin
      .from('discount_code_uses')
      .insert({ discount_code_id: discountCodeId, user_id: userId, order_id: order.id });
    // Atomic increment — avoids race condition on concurrent checkouts
    await supabaseAdmin.rpc('increment_discount_code_usage' as never, { p_code_id: discountCodeId });
  }

  ordersCreatedTotal.inc({ status: 'pending' });

  // Send confirmation email
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .single();
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authUser.user?.email) {
    sendEmail({
      to: [{ email: authUser.user.email, name: profile?.name }],
      ...templates.orderConfirmed(orderNumber, totalAmount),
    }).catch(() => {}); // non-blocking
  }

  return order;
}

export async function cancelOrder(userId: string, orderId: string, reason?: string) {
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('order_status, user_id')
    .eq('id', orderId)
    .single();

  if (error || !order) throw new NotFoundError('Order');
  if (order.user_id !== userId) throw new NotFoundError('Order');
  if (!['pending', 'paid'].includes(order.order_status)) {
    throw new BadRequestError('Order cannot be cancelled at this stage');
  }

  const { data, error: updateErr } = await supabaseAdmin
    .from('orders')
    .update({
      order_status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
    })
    .eq('id', orderId)
    .select('id, order_number, order_status')
    .single();

  if (updateErr || !data) throw new BadRequestError('Cancel failed');

  await writeAuditLog({
    actorId: userId,
    action: 'order.cancel',
    entityType: 'orders',
    entityId: orderId,
    newValue: { reason },
  });

  return data;
}
