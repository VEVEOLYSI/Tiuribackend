import { createHmac } from 'crypto';
import { supabaseAdmin } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { paymentsProcessedTotal } from '../config/metrics.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import * as ordersService from '../orders/orders.service.js';

// ─── Paystack API helpers ─────────────────────────────────────────────────────

const PAYSTACK_BASE = 'https://api.paystack.co';

async function paystackRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as { status: boolean; message: string; data: T };

  if (!data.status) {
    throw new BadRequestError(`Paystack error: ${data.message}`);
  }

  return data.data;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaystackInitData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

interface PaystackVerifyData {
  status: 'success' | 'failed' | 'abandoned' | 'pending';
  reference: string;
  amount: number;
  currency: string;
  metadata: { orderId?: string; bookingId?: string; userId?: string };
}

export type ChargeStatus =
  | 'success'
  | 'send_pin'
  | 'send_otp'
  | 'send_birthday'
  | 'open_url'
  | 'pay_offline'
  | 'pending'
  | 'failed';

export interface ChargeResponse {
  status: ChargeStatus;
  reference: string;
  message?: string;
  displayText?: string;
  redirectUrl?: string;
  orderId?: string;
}

export interface CheckoutData {
  items: Array<{ productId: string; variantId?: string; quantity: number }>;
  addressId?: string;
  discountCode?: string;
  shippingAmount?: number;
  notes?: string;
  idempotencyKey?: string;
}

// ─── Initialize payment (redirect flow) ──────────────────────────────────────

export async function initializePayment(
  userId: string,
  payload: { orderId?: string; bookingId?: string }
) {
  if (!payload.orderId && !payload.bookingId) {
    throw new BadRequestError('Provide orderId or bookingId');
  }

  const amount = await resolvePayableAmount(payload.orderId, payload.bookingId);

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!authUser.user?.email) throw new BadRequestError('User email not found');

  const existingRef = await findPendingRef(payload.orderId, payload.bookingId);
  if (existingRef) {
    logger.info('Reusing pending Paystack transaction', { reference: existingRef });
    return { authorizationUrl: null, accessCode: null, reference: existingRef, reused: true };
  }

  const initData = await paystackRequest<PaystackInitData>('POST', '/transaction/initialize', {
    email: authUser.user.email,
    amount: Math.round(amount * 100),
    currency: 'KES',
    callback_url: `${env.APP_URL}/api/v1/payments/paystack/callback`,
    metadata: {
      userId,
      orderId: payload.orderId ?? null,
      bookingId: payload.bookingId ?? null,
    },
  });

  const { error } = await supabaseAdmin.from('payment_transactions').insert({
    user_id: userId,
    order_id: payload.orderId ?? null,
    booking_id: payload.bookingId ?? null,
    gateway: 'paystack',
    gateway_ref: initData.reference,
    amount,
    currency: 'KES',
    status: 'pending',
  });

  if (error) logger.error('Failed to record payment transaction', { error: error.message });

  return {
    authorizationUrl: initData.authorization_url,
    accessCode: initData.access_code,
    reference: initData.reference,
    reused: false,
  };
}

// ─── Verify payment ───────────────────────────────────────────────────────────

export async function verifyPayment(reference: string) {
  const data = await paystackRequest<PaystackVerifyData>(
    'GET',
    `/transaction/verify/${encodeURIComponent(reference)}`
  );

  const { orderId, bookingId } = data.metadata ?? {};

  if (data.status === 'success') {
    const settled = await settlePayment(reference, orderId, bookingId);
    return { verified: true, status: 'success', reference, orderId: settled.orderId, bookingId };
  }

  await supabaseAdmin
    .from('payment_transactions')
    .update({ status: data.status === 'failed' ? 'failed' : 'pending' })
    .eq('gateway_ref', reference);

  return { verified: false, status: data.status, reference };
}

// ─── Charge card (custom UI — no redirect) ────────────────────────────────────

export async function chargeCard(
  userId: string,
  payload: {
    orderId?: string;
    bookingId?: string;
    checkout?: CheckoutData;
    card: { number: string; cvv: string; expiryMonth: string; expiryYear: string };
    pin?: string;
  }
): Promise<ChargeResponse> {
  if (!payload.orderId && !payload.bookingId && !payload.checkout) {
    throw new BadRequestError('Provide orderId, bookingId, or checkout data');
  }

  let amount: number;
  if (payload.checkout) {
    amount = await resolveCheckoutTotal(payload.checkout);
  } else {
    amount = await resolvePayableAmount(payload.orderId, payload.bookingId);
  }

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!authUser.user?.email) throw new BadRequestError('User email not found');

  const existingRef = await findPendingRef(payload.orderId, payload.bookingId);
  const reference = existingRef ?? `wigs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const chargeBody: Record<string, unknown> = {
    email: authUser.user.email,
    amount: Math.round(amount * 100),
    reference,
    card: {
      number: payload.card.number.replace(/\s/g, ''),
      cvv: payload.card.cvv,
      expiry_month: payload.card.expiryMonth.padStart(2, '0'),
      expiry_year: payload.card.expiryYear,
    },
    metadata: {
      userId,
      orderId: payload.orderId ?? null,
      bookingId: payload.bookingId ?? null,
    },
  };

  if (payload.pin) chargeBody.pin = payload.pin;

  const raw = await fetch(`${PAYSTACK_BASE}/charge`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(chargeBody),
  });

  const result = (await raw.json()) as {
    status: boolean;
    message: string;
    data: {
      status: ChargeStatus;
      reference: string;
      message?: string;
      display_text?: string;
      url?: string;
    };
  };

  if (!existingRef) {
    await supabaseAdmin.from('payment_transactions').insert({
      user_id: userId,
      order_id: payload.orderId ?? null,
      booking_id: payload.bookingId ?? null,
      gateway: 'paystack',
      gateway_ref: reference,
      amount,
      currency: 'KES',
      status: 'pending',
      checkout_data: payload.checkout ?? null,
    });
  }

  if (!result.status) {
    logger.warn('Paystack charge failed', { message: result.message, reference });
    await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'failed', failure_reason: result.message })
      .eq('gateway_ref', reference);
    throw new BadRequestError(result.message ?? 'Card charge failed');
  }

  const d = result.data;
  logger.info('Paystack charge status', { status: d.status, reference: d.reference });

  let createdOrderId: string | undefined;
  if (d.status === 'success') {
    const settled = await settlePayment(d.reference, payload.orderId, payload.bookingId);
    createdOrderId = settled.orderId;
  }

  return {
    status: d.status,
    reference: d.reference ?? reference,
    message: d.message,
    displayText: d.display_text,
    redirectUrl: d.url,
    orderId: createdOrderId ?? payload.orderId,
  };
}

// ─── M-Pesa charge (STK push) ─────────────────────────────────────────────────

export async function chargeMpesa(
  userId: string,
  payload: {
    phone: string;
    orderId?: string;
    bookingId?: string;
    checkout?: CheckoutData;
  }
): Promise<ChargeResponse> {
  if (!payload.orderId && !payload.bookingId && !payload.checkout) {
    throw new BadRequestError('Provide orderId, bookingId, or checkout data');
  }

  let amount: number;
  if (payload.checkout) {
    amount = await resolveCheckoutTotal(payload.checkout);
  } else {
    amount = await resolvePayableAmount(payload.orderId, payload.bookingId);
  }

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!authUser.user?.email) throw new BadRequestError('User email not found');

  const reference = `mpesa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Normalise phone: Paystack Kenya expects 07XX... or 01XX... (10 digits)
  const phone = payload.phone.trim()
    .replace(/^\+254/, '0')
    .replace(/^254/, '0')
    .replace(/\s/g, '');

  // Record transaction before calling Paystack
  await supabaseAdmin.from('payment_transactions').insert({
    user_id: userId,
    order_id: payload.orderId ?? null,
    booking_id: payload.bookingId ?? null,
    gateway: 'paystack',
    gateway_ref: reference,
    amount,
    currency: 'KES',
    status: 'pending',
    checkout_data: payload.checkout ?? null,
  });

  const raw = await fetch(`${PAYSTACK_BASE}/charge`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: authUser.user.email,
      amount: Math.round(amount * 100),
      reference,
      currency: 'KES',
      mobile_money: { phone, provider: 'mpesa' },
      metadata: {
        userId,
        orderId: payload.orderId ?? null,
        bookingId: payload.bookingId ?? null,
      },
    }),
  });

  const result = (await raw.json()) as {
    status: boolean;
    message: string;
    data: { status: ChargeStatus; reference: string; display_text?: string };
  };

  if (!result.status) {
    await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'failed', failure_reason: result.message })
      .eq('gateway_ref', reference);
    throw new BadRequestError(result.message ?? 'M-Pesa charge failed');
  }

  const d = result.data;
  logger.info('M-Pesa charge initiated', { status: d.status, reference });

  let createdOrderId: string | undefined;
  if (d.status === 'success') {
    const settled = await settlePayment(reference, payload.orderId, payload.bookingId);
    createdOrderId = settled.orderId;
  }

  return {
    status: d.status,
    reference,
    displayText: d.display_text ?? 'Check your phone for the M-Pesa STK push prompt.',
    orderId: createdOrderId,
  };
}

// ─── M-Pesa status poll ───────────────────────────────────────────────────────

export async function checkMpesaStatus(reference: string): Promise<{
  status: 'pending' | 'success' | 'failed';
  orderId?: string;
}> {
  const { data: txn } = await supabaseAdmin
    .from('payment_transactions')
    .select('status, order_id')
    .eq('gateway_ref', reference)
    .maybeSingle();

  if (!txn) throw new NotFoundError('Transaction');

  if (txn.status === 'success') {
    return { status: 'success', orderId: txn.order_id ?? undefined };
  }
  if (txn.status === 'failed') {
    return { status: 'failed' };
  }

  // Ask Paystack for the latest status
  const raw = await fetch(`${PAYSTACK_BASE}/charge/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
  });
  const result = (await raw.json()) as {
    status: boolean;
    data: { status: string };
  };

  if (result.status && result.data?.status === 'success') {
    const settled = await settlePayment(reference);
    return { status: 'success', orderId: settled.orderId };
  }

  if (result.status && result.data?.status === 'failed') {
    await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'failed' })
      .eq('gateway_ref', reference);
    return { status: 'failed' };
  }

  return { status: 'pending' };
}

// ─── Submit OTP ───────────────────────────────────────────────────────────────

export async function submitOtp(reference: string, otp: string): Promise<ChargeResponse> {
  const raw = await fetch(`${PAYSTACK_BASE}/charge/submit_otp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ otp, reference }),
  });

  const result = (await raw.json()) as {
    status: boolean;
    message: string;
    data: { status: ChargeStatus; reference: string; message?: string; display_text?: string };
  };

  if (!result.status) throw new BadRequestError(result.message ?? 'OTP submission failed');

  const d = result.data;
  let createdOrderId: string | undefined;
  if (d.status === 'success') {
    const settled = await settlePayment(reference);
    createdOrderId = settled.orderId;
  }

  return {
    status: d.status,
    reference,
    message: d.message,
    displayText: d.display_text,
    orderId: createdOrderId,
  };
}

// ─── Submit PIN ───────────────────────────────────────────────────────────────

export async function submitPin(reference: string, pin: string): Promise<ChargeResponse> {
  const raw = await fetch(`${PAYSTACK_BASE}/charge/submit_pin`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pin, reference }),
  });

  const result = (await raw.json()) as {
    status: boolean;
    message: string;
    data: { status: ChargeStatus; reference: string; message?: string; display_text?: string; url?: string };
  };

  if (!result.status) throw new BadRequestError(result.message ?? 'PIN submission failed');

  const d = result.data;
  let createdOrderId: string | undefined;
  if (d.status === 'success') {
    const settled = await settlePayment(reference);
    createdOrderId = settled.orderId;
  }

  return {
    status: d.status,
    reference,
    message: d.message,
    displayText: d.display_text,
    redirectUrl: d.url,
    orderId: createdOrderId,
  };
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export async function handleWebhook(rawBody: string, signature: string) {
  const expected = createHmac('sha512', env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  if (expected !== signature) {
    throw new BadRequestError('Invalid Paystack webhook signature');
  }

  const event = JSON.parse(rawBody) as {
    event: string;
    data: {
      reference: string;
      status: string;
      metadata?: { orderId?: string; bookingId?: string };
    };
  };

  logger.info('Paystack webhook received', { event: event.event, reference: event.data.reference });

  if (event.event === 'charge.success') {
    const { reference, metadata } = event.data;
    await settlePayment(reference, metadata?.orderId, metadata?.bookingId);
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function resolvePayableAmount(orderId?: string, bookingId?: string): Promise<number> {
  if (orderId) {
    const { data } = await supabaseAdmin
      .from('orders')
      .select('total_amount, payment_status')
      .eq('id', orderId)
      .single();

    if (!data) throw new NotFoundError('Order');
    if (data.payment_status === 'paid') throw new BadRequestError('Order already paid');
    return Number(data.total_amount);
  }

  if (bookingId) {
    const { data } = await supabaseAdmin
      .from('service_bookings')
      .select('price, status')
      .eq('id', bookingId)
      .single();

    if (!data) throw new NotFoundError('Booking');
    if (data.status === 'confirmed') throw new BadRequestError('Booking already paid');
    return Number(data.price);
  }

  throw new BadRequestError('Provide orderId or bookingId');
}

async function resolveCheckoutTotal(checkout: CheckoutData): Promise<number> {
  let subtotal = 0;

  for (const item of checkout.items) {
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('price, variants, stock')
      .eq('id', item.productId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .single();

    if (!product) throw new BadRequestError(`Product ${item.productId} not found or unavailable`);

    let unitPrice: number = product.price;
    if (item.variantId) {
      const variant = (product.variants as Array<{ id: string; price_modifier?: number }>)
        .find((v) => v.id === item.variantId);
      if (variant?.price_modifier) unitPrice += variant.price_modifier;
    }
    subtotal += unitPrice * item.quantity;
  }

  let discountAmount = 0;
  if (checkout.discountCode) {
    const { data: dc } = await supabaseAdmin
      .from('discount_codes')
      .select('type, value, min_order_amount, max_discount_cap')
      .eq('code', checkout.discountCode.toUpperCase())
      .eq('is_active', true)
      .single();

    if (dc) {
      discountAmount = dc.type === 'percent'
        ? Math.min(subtotal * (dc.value / 100), dc.max_discount_cap ?? Infinity)
        : dc.value;
    }
  }

  return Math.max(0, subtotal - discountAmount + (checkout.shippingAmount ?? 0));
}

async function findPendingRef(orderId?: string, bookingId?: string): Promise<string | null> {
  if (!orderId && !bookingId) return null;
  const field = orderId ? 'order_id' : 'booking_id';
  const id = orderId ?? bookingId;

  const { data } = await supabaseAdmin
    .from('payment_transactions')
    .select('gateway_ref')
    .eq(field, id!)
    .eq('gateway', 'paystack')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.gateway_ref ?? null;
}

// Creates the order from checkout_data when orderId is not yet set, then marks
// the transaction + order as paid. Returns the resolved orderId.
async function settlePayment(
  reference: string,
  orderId?: string | null,
  bookingId?: string | null
): Promise<{ orderId?: string }> {
  // Fetch the transaction to get checkout_data and guard idempotency
  const { data: txn } = await supabaseAdmin
    .from('payment_transactions')
    .select('id, status, order_id, booking_id, user_id, checkout_data')
    .eq('gateway_ref', reference)
    .maybeSingle();

  if (txn?.status === 'success') {
    logger.info('Payment already settled, skipping', { reference });
    return { orderId: txn.order_id ?? orderId ?? undefined };
  }

  // Prefer values already stored in the transaction record
  let finalOrderId: string | null = orderId ?? txn?.order_id ?? null;
  const finalBookingId = bookingId ?? txn?.booking_id ?? null;

  // If checkout_data present and no order exists yet → create it now
  const checkoutData = txn?.checkout_data as CheckoutData | null;
  if (checkoutData && !finalOrderId && txn?.user_id) {
    try {
      const order = await ordersService.createOrder(txn.user_id, checkoutData);
      finalOrderId = order.id;
      await supabaseAdmin
        .from('payment_transactions')
        .update({ order_id: finalOrderId })
        .eq('gateway_ref', reference);
    } catch (err) {
      logger.error('Failed to create order from checkout_data during settlement', { reference, err });
    }
  }

  // Mark transaction as succeeded
  await supabaseAdmin
    .from('payment_transactions')
    .update({ status: 'success' })
    .eq('gateway_ref', reference);

  if (finalOrderId) {
    await supabaseAdmin
      .from('orders')
      .update({ payment_status: 'paid', order_status: 'processing' })
      .eq('id', finalOrderId);
  }

  if (finalBookingId) {
    await supabaseAdmin
      .from('service_bookings')
      .update({ status: 'confirmed' })
      .eq('id', finalBookingId);
  }

  paymentsProcessedTotal.inc({ gateway: 'paystack', status: 'success' });
  logger.info('Payment settled', { reference, orderId: finalOrderId, bookingId: finalBookingId });

  return { orderId: finalOrderId ?? undefined };
}
