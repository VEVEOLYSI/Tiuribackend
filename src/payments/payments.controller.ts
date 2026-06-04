import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './payments.service.js';
import { ok } from '../utils/response.js';
import { env } from '../config/env.js';
import type { AppEnv } from '../types/index.js';

const targetSchema = z.object({
  orderId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
});

const checkoutSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    quantity: z.number().int().min(1).max(100),
  })).min(1),
  addressId: z.string().uuid().optional(),
  discountCode: z.string().max(50).optional(),
  shippingAmount: z.number().nonnegative().optional(),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

// POST /api/v1/payments/paystack/initialize
export const initialize = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = targetSchema.parse(await c.req.json());
  return ok(c, await svc.initializePayment(user.id, body), 201);
};

// GET /api/v1/payments/paystack/verify/:reference
export const verify = async (c: Context<AppEnv>) => {
  const { reference } = c.req.param();
  return ok(c, await svc.verifyPayment(reference));
};

// GET /api/v1/payments/paystack/callback  (Paystack redirect)
export const callback = async (c: Context<AppEnv>) => {
  const reference = c.req.query('reference') ?? '';
  if (!reference) return c.redirect(`${env.FRONTEND_URL}/payment/failed`);
  try {
    const result = await svc.verifyPayment(reference);
    const target = result.verified
      ? `${env.FRONTEND_URL}/payment/success?reference=${reference}`
      : `${env.FRONTEND_URL}/payment/failed?reference=${reference}`;
    return c.redirect(target, 302);
  } catch {
    return c.redirect(`${env.FRONTEND_URL}/payment/failed?reference=${reference}`, 302);
  }
};

// POST /api/v1/payments/paystack/webhook
export const webhook = async (c: Context<AppEnv>) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-paystack-signature') ?? '';
  await svc.handleWebhook(rawBody, signature);
  return c.json({ received: true });
};

// GET /api/v1/payments/public-key
export const publicKey = async (c: Context<AppEnv>) => {
  return ok(c, { publicKey: env.PAYSTACK_PUBLIC_KEY });
};

// ─── Card charge ──────────────────────────────────────────────────────────────

const cardSchema = z.object({
  number: z.string().min(15).max(19),
  cvv: z.string().min(3).max(4),
  expiryMonth: z.string().length(2),
  expiryYear: z.string().min(2).max(4),
});

// POST /api/v1/payments/paystack/charge
export const charge = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = z
    .object({
      card: cardSchema,
      pin: z.string().min(4).max(6).optional(),
      orderId: z.string().uuid().optional(),
      bookingId: z.string().uuid().optional(),
      checkout: checkoutSchema.optional(),
    })
    .parse(await c.req.json());

  return ok(c, await svc.chargeCard(user.id, body), 201);
};

// POST /api/v1/payments/paystack/submit-pin
export const submitPin = async (c: Context<AppEnv>) => {
  const { reference, pin } = z
    .object({ reference: z.string().min(1), pin: z.string().min(4).max(6) })
    .parse(await c.req.json());
  return ok(c, await svc.submitPin(reference, pin));
};

// POST /api/v1/payments/paystack/submit-otp
export const submitOtp = async (c: Context<AppEnv>) => {
  const { reference, otp } = z
    .object({ reference: z.string().min(1), otp: z.string().min(4).max(8) })
    .parse(await c.req.json());
  return ok(c, await svc.submitOtp(reference, otp));
};

// ─── M-Pesa ───────────────────────────────────────────────────────────────────

// POST /api/v1/payments/paystack/mpesa
export const mpesaCharge = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = z
    .object({
      phone: z.string().min(9).max(15),
      orderId: z.string().uuid().optional(),
      bookingId: z.string().uuid().optional(),
      checkout: checkoutSchema.optional(),
    })
    .parse(await c.req.json());

  return ok(c, await svc.chargeMpesa(user.id, body), 201);
};

// GET /api/v1/payments/paystack/mpesa/status/:reference
export const mpesaStatus = async (c: Context<AppEnv>) => {
  const { reference } = c.req.param();
  return ok(c, await svc.checkMpesaStatus(reference));
};
