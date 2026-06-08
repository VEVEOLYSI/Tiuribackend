import { createHmac } from 'crypto';
import { supabaseAdmin } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { paymentsProcessedTotal } from '../config/metrics.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import * as ordersService from '../orders/orders.service.js';
import { sendEmail, templates } from '../config/email.js';

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
  metadata: {
    orderId?: string;
    bookingId?: string;
    userId?: string;
    checkoutData?: CheckoutData;
  };
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

// ─── Initialize payment (redirect / Paystack-hosted flow) ────────────────────

export async function initializePayment(
  userId: string,
  payload: { orderId?: string; bookingId?: string; checkout?: CheckoutData }
) {
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
  if (existingRef) {
    // Expire the stale transaction — user reopened the payment dialog without completing.
    // If they had paid, the webhook would have already marked it 'success'.
    await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'failed', failure_reason: 'Superseded by new payment attempt' })
      .eq('gateway_ref', existingRef)
      .eq('status', 'pending');
    logger.info('Expired stale pending transaction, creating fresh one', { reference: existingRef });
  }

  const initData = await paystackRequest<PaystackInitData>('POST', '/transaction/initialize', {
    email: authUser.user.email,
    amount: Math.round(amount * 100),
    currency: 'KES',
    callback_url: `${env.APP_URL}/api/v1/payments/paystack/callback`,
    channels: ['mobile_money', 'card'],
    metadata: {
      userId,
      orderId: payload.orderId ?? null,
      bookingId: payload.bookingId ?? null,
      checkoutData: payload.checkout ?? null,
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
    checkout_data: payload.checkout ?? null,
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

  const { orderId, bookingId, userId, checkoutData } = data.metadata ?? {};

  if (data.status === 'success') {
    const settled = await settlePayment(
      reference,
      orderId || null,
      bookingId || null,
      { checkoutData, userId }
    );
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
    const { error: insertErr } = await supabaseAdmin.from('payment_transactions').insert({
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
    if (insertErr) logger.warn('Card transaction insert warning', { error: insertErr.message });
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

  // Normalise to local format 07XXXXXXXX / 01XXXXXXXX first, then convert to
  // international 254XXXXXXXXX — Paystack's /charge mobile_money requires the
  // E.164 country-code form without the leading zero.
  let phone = payload.phone.trim().replace(/[\s\-().+]/g, '');
  if (phone.startsWith('254') && phone.length === 12) {
    phone = '0' + phone.slice(3);            // 254712345678 → 0712345678
  } else if (phone.startsWith('254') && phone.length === 11) {
    phone = '0' + phone.slice(3);            // 25411234567  → 011234567 (Airtel)
  } else if (!phone.startsWith('0') && phone.length === 9) {
    phone = '0' + phone;                     // 712345678    → 0712345678
  }

  if (!/^0[17]\d{8}$/.test(phone)) {
    throw new BadRequestError('Invalid phone number. Use format 0712345678 or 0112345678');
  }

  // Paystack expects +254XXXXXXXXX (E.164 format with +)
  const paystackPhone = '+254' + phone.slice(1);

  logger.info('M-Pesa charge: normalised phone', { input: payload.phone, local: phone, paystack: paystackPhone });

  // Record transaction before calling Paystack
  const { error: insertErr } = await supabaseAdmin.from('payment_transactions').insert({
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

  if (insertErr) {
    logger.error('Failed to record M-Pesa transaction', { error: insertErr.message });
    if (insertErr.message.includes('checkout_data')) {
      throw new BadRequestError(
        'Database migration required: run sql/add_checkout_data_column.sql in Supabase SQL Editor.'
      );
    }
    // Non-fatal column issues — continue but log
    logger.warn('Transaction insert warning, proceeding anyway', { error: insertErr.message });
  }

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
      mobile_money: { phone: paystackPhone, provider: 'mpesa' },
      // Store checkout_data in metadata so webhook can create the order
      // even if the DB insert above had issues
      metadata: {
        userId,
        orderId: payload.orderId ?? null,
        bookingId: payload.bookingId ?? null,
        checkoutData: payload.checkout ?? null,
      },
    }),
  });

  const result = (await raw.json()) as {
    status: boolean;
    message: string;
    data: { status: ChargeStatus; reference: string; display_text?: string };
  };

  logger.info('Paystack M-Pesa raw response', { status: result.status, message: result.message });

  if (!result.status) {
    await supabaseAdmin
      .from('payment_transactions')
      .update({ status: 'failed', failure_reason: result.message })
      .eq('gateway_ref', reference);

    // Surface a helpful message for common Paystack configuration errors
    const msg = result.message ?? 'M-Pesa charge failed';
    const isConfigError =
      /not enabled|not supported|channel|mobile.?money|provider/i.test(msg);
    throw new BadRequestError(
      isConfigError
        ? `M-Pesa is not enabled on this Paystack account. Go to Paystack Dashboard → Settings → Payment Channels → enable Mobile Money (M-Pesa). Original error: ${msg}`
        : `M-Pesa payment failed: ${msg}`
    );
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
      metadata?: {
        orderId?: string;
        bookingId?: string;
        userId?: string;
        checkoutData?: CheckoutData;
      };
    };
  };

  logger.info('Paystack webhook received', { event: event.event, reference: event.data.reference });

  if (event.event === 'charge.success') {
    const { reference, metadata } = event.data;
    await settlePayment(
      reference,
      metadata?.orderId || null,
      metadata?.bookingId || null,
      { checkoutData: metadata?.checkoutData, userId: metadata?.userId }
    );
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
    const amount = Number(data.total_amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestError('Invalid order amount');
    return amount;
  }

  if (bookingId) {
    const { data } = await supabaseAdmin
      .from('service_bookings')
      .select('price, deposit_amount, status')
      .eq('id', bookingId)
      .single();

    if (!data) throw new NotFoundError('Booking');
    if (data.status === 'confirmed') throw new BadRequestError('Deposit already paid for this booking');
    const depositAmount = Number(data.deposit_amount ?? 0);
    const amount = depositAmount > 0 ? depositAmount : Number(data.price);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestError('Invalid booking amount');
    return amount;
  }

  throw new BadRequestError('Provide orderId or bookingId');
}

async function resolveCheckoutTotal(checkout: CheckoutData): Promise<number> {
  // Supabase returns NUMERIC columns as strings in some configurations.
  // Explicit Number() casts throughout prevent string concatenation bugs
  // where e.g. "2" + "0" = "20" instead of 2 + 0 = 2.
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

    let unitPrice = Number(product.price);           // always a numeric value
    if (item.variantId) {
      const variant = (product.variants as Array<{ id: string; price_modifier?: number }>)
        .find((v) => v.id === item.variantId);
      const modifier = Number(variant?.price_modifier ?? 0);
      if (modifier !== 0) unitPrice += modifier;     // skip string-truthy "0" values
    }
    subtotal += unitPrice * Number(item.quantity);   // guard quantity too
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
      const dcValue = Number(dc.value);
      const cap    = dc.max_discount_cap != null ? Number(dc.max_discount_cap) : Infinity;
      discountAmount = dc.type === 'percent'
        ? Math.min(subtotal * (dcValue / 100), cap)
        : dcValue;
    }
  }

  const shipping = Number(checkout.shippingAmount ?? 0);
  return Math.max(0, subtotal - discountAmount + shipping);
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
// fallback is used when the DB transaction record is missing (e.g. checkout_data
// column not yet migrated) — we pull checkoutData + userId from Paystack metadata.
async function settlePayment(
  reference: string,
  orderId?: string | null,
  bookingId?: string | null,
  fallback?: { checkoutData?: CheckoutData | null; userId?: string }
): Promise<{ orderId?: string }> {
  // Normalise empty-string ids (Paystack sometimes returns "" for null fields)
  const normOrderId = orderId || null;
  const normBookingId = bookingId || null;

  // Fetch the transaction to get checkout_data and guard idempotency
  const { data: txn } = await supabaseAdmin
    .from('payment_transactions')
    .select('id, status, order_id, booking_id, user_id, checkout_data')
    .eq('gateway_ref', reference)
    .maybeSingle();

  if (txn?.status === 'success') {
    logger.info('Payment already settled, skipping', { reference });
    return { orderId: txn.order_id ?? normOrderId ?? undefined };
  }

  // Prefer values stored in the transaction record; fallback to caller params
  let finalOrderId: string | null = normOrderId ?? txn?.order_id ?? null;
  const finalBookingId = normBookingId ?? txn?.booking_id ?? null;

  // Checkout data: DB record first, then Paystack metadata fallback
  const checkoutData = (txn?.checkout_data ?? fallback?.checkoutData) as CheckoutData | null;
  const userId = txn?.user_id ?? fallback?.userId;

  // If we have checkout data but no order yet → create the order now
  if (checkoutData && !finalOrderId && userId) {
    try {
      const order = await ordersService.createOrder(userId, checkoutData);
      finalOrderId = order.id;
      if (txn) {
        await supabaseAdmin
          .from('payment_transactions')
          .update({ order_id: finalOrderId })
          .eq('gateway_ref', reference);
      }
      logger.info('Order created from checkout_data', { reference, orderId: finalOrderId });
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
    // Fetch booking details before update so we can send the confirmation email
    const { data: bk } = await supabaseAdmin
      .from('service_bookings')
      .select('booking_number, scheduled_date, scheduled_time, user_id, services(name)')
      .eq('id', finalBookingId)
      .maybeSingle();

    await supabaseAdmin
      .from('service_bookings')
      .update({ status: 'confirmed', deposit_paid_at: new Date().toISOString() })
      .eq('id', finalBookingId);

    // Send confirmation email now that deposit is paid
    if (bk) {
      const svc = bk.services as { name: string } | { name: string }[] | null;
      const serviceName = (Array.isArray(svc) ? svc[0]?.name : svc?.name) ?? 'Service';
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(bk.user_id as string);
      const { data: profile } = await supabaseAdmin
        .from('profiles').select('name').eq('id', bk.user_id as string).maybeSingle();
      if (authUser.user?.email) {
        sendEmail({
          to: [{ email: authUser.user.email, name: profile?.name ?? undefined }],
          ...templates.bookingConfirmed(
            bk.booking_number as string,
            serviceName,
            bk.scheduled_date as string,
            bk.scheduled_time as string,
          ),
        }).catch(() => {});
      }
    }
  }

  paymentsProcessedTotal.inc({ gateway: 'paystack', status: 'success' });
  logger.info('Payment settled', { reference, orderId: finalOrderId, bookingId: finalBookingId });

  return { orderId: finalOrderId ?? undefined };
}
