import { createHmac } from 'crypto';
import { supabaseAdmin } from '../config/db.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { paymentsProcessedTotal } from '../config/metrics.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

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

// ─── Initialize payment ───────────────────────────────────────────────────────

export async function initializePayment(
  userId: string,
  payload: { orderId?: string; bookingId?: string }
) {
  if (!payload.orderId && !payload.bookingId) {
    throw new BadRequestError('Provide orderId or bookingId');
  }

  const amount = await resolvePayableAmount(payload.orderId, payload.bookingId);

  // Fetch the user's email (required by Paystack)
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!authUser.user?.email) throw new BadRequestError('User email not found');

  // Check idempotency: reuse pending transaction for same order/booking
  const existingRef = await findPendingRef(payload.orderId, payload.bookingId);
  if (existingRef) {
    logger.info('Reusing pending Paystack transaction', { reference: existingRef });
    return { authorizationUrl: null, accessCode: null, reference: existingRef, reused: true };
  }

  const initData = await paystackRequest<PaystackInitData>('POST', '/transaction/initialize', {
    email: authUser.user.email,
    // Paystack expects amount in kobo (KES subunit = cents, 1 KES = 100 kobo)
    amount: Math.round(amount * 100),
    currency: 'KES',
    callback_url: `${env.APP_URL}/api/v1/payments/paystack/callback`,
    metadata: {
      userId,
      orderId: payload.orderId ?? null,
      bookingId: payload.bookingId ?? null,
    },
  });

  // Record the pending transaction
  const { error } = await supabaseAdmin.from('payment_transactions').insert({
    user_id: userId,
    order_id: payload.orderId ?? null,
    booking_id: payload.bookingId ?? null,
    // The DB enum currently has 'mpesa'|'stripe'|'cash'; run sql/add_paystack_gateway.sql first
    gateway: 'paystack',
    gateway_ref: initData.reference,
    amount,
    currency: 'KES',
    status: 'pending',
  });

  if (error) {
    logger.error('Failed to record payment transaction', { error: error.message });
  }

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
    await settlePayment(reference, orderId, bookingId);
    return { verified: true, status: 'success', reference, orderId, bookingId };
  }

  // Update transaction record for non-success statuses
  await supabaseAdmin
    .from('payment_transactions')
    .update({ status: data.status === 'failed' ? 'failed' : 'pending' })
    .eq('gateway_ref', reference);

  return { verified: false, status: data.status, reference };
}

// ─── Charge API (custom UI — no redirect) ────────────────────────────────────

export type ChargeStatus =
  | 'success'
  | 'send_pin'
  | 'send_otp'
  | 'send_birthday'
  | 'open_url'
  | 'failed';

interface ChargeResponse {
  status: ChargeStatus;
  reference: string;
  message?: string;
  displayText?: string;
  redirectUrl?: string;
}

export async function chargeCard(
  userId: string,
  payload: {
    orderId?: string;
    bookingId?: string;
    card: { number: string; cvv: string; expiryMonth: string; expiryYear: string };
    pin?: string;
  }
): Promise<ChargeResponse> {
  if (!payload.orderId && !payload.bookingId) {
    throw new BadRequestError('Provide orderId or bookingId');
  }

  const amount = await resolvePayableAmount(payload.orderId, payload.bookingId);
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!authUser.user?.email) throw new BadRequestError('User email not found');

  // Reuse a pending reference or create a fresh one
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

  // Record transaction if new
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

  if (d.status === 'success') {
    await settlePayment(d.reference, payload.orderId, payload.bookingId);
  }

  return {
    status: d.status,
    reference: d.reference ?? reference,
    message: d.message,
    displayText: d.display_text,
    redirectUrl: d.url,
  };
}

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
  if (d.status === 'success') {
    const { data: txn } = await supabaseAdmin
      .from('payment_transactions')
      .select('order_id, booking_id')
      .eq('gateway_ref', reference)
      .single();
    if (txn) await settlePayment(reference, txn.order_id, txn.booking_id);
  }

  return { status: d.status, reference, message: d.message, displayText: d.display_text };
}

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
  if (d.status === 'success') {
    const { data: txn } = await supabaseAdmin
      .from('payment_transactions')
      .select('order_id, booking_id')
      .eq('gateway_ref', reference)
      .single();
    if (txn) await settlePayment(reference, txn.order_id, txn.booking_id);
  }

  return { status: d.status, reference, message: d.message, displayText: d.display_text, redirectUrl: d.url };
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export async function handleWebhook(rawBody: string, signature: string) {
  // Paystack signs with HMAC-SHA512 using your secret key
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

async function findPendingRef(orderId?: string, bookingId?: string): Promise<string | null> {
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

async function settlePayment(
  reference: string,
  orderId?: string | null,
  bookingId?: string | null
) {
  // Mark transaction as success
  await supabaseAdmin
    .from('payment_transactions')
    .update({ status: 'success' })
    .eq('gateway_ref', reference);

  if (orderId) {
    await supabaseAdmin
      .from('orders')
      .update({ payment_status: 'paid', order_status: 'processing' })
      .eq('id', orderId);
  }

  if (bookingId) {
    await supabaseAdmin
      .from('service_bookings')
      .update({ status: 'confirmed' })
      .eq('id', bookingId);
  }

  paymentsProcessedTotal.inc({ gateway: 'paystack', status: 'success' });
  logger.info('Payment settled via Paystack', { reference, orderId, bookingId });
}
