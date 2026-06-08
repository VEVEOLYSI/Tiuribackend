import { Resend } from 'resend';
import { env } from './env.js';
import { logger } from './logger.js';

// Resend HTTP API — no SMTP port issues on Render or any cloud host.
// SMTP_PASS holds the Resend API key (re-used so no extra env var needed).
const resend = new Resend(env.SMTP_PASS);

// Verify connectivity at startup (non-fatal)
resend.domains.list().then(() => {
  logger.info('Resend (email) connected', { from: env.EMAIL_FROM });
}).catch((err: Error) => {
  logger.warn('Resend connectivity check failed — emails may not send', { error: err.message });
});

export interface EmailPayload {
  to: { email: string; name?: string }[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const toAddresses = payload.to.map((r) =>
    r.name ? `${r.name} <${r.email}>` : r.email
  );

  const { error } = await resend.emails.send({
    from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`,
    to: toAddresses,
    subject: payload.subject,
    html: payload.html,
    ...(payload.text  && { text:    payload.text }),
    ...(payload.replyTo && { replyTo: payload.replyTo }),
  });

  if (error) {
    logger.error('Email send failed', { error: error.message, subject: payload.subject });
    throw new Error(error.message);
  }

  logger.info('Email sent', {
    to: payload.to.map((r) => r.email),
    subject: payload.subject,
  });
}

export const templates = {
  otpVerification: (name: string, otp: string) => ({
    subject: 'Your verification code — Tiuri Nails & Wigs Parlour',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <div style="text-align:center;margin-bottom:24px">
          <h1 style="color:#0a2e1f;margin:0 0 8px">Verify your email</h1>
          <p style="color:#6b7280;margin:0">Hi${name ? ` ${name}` : ''},</p>
        </div>
        <p style="color:#374151">Thanks for creating an account with <strong>Tiuri Nails &amp; Wigs Parlour</strong>.
           Enter the code below to verify your email address and activate your account.</p>
        <div style="background:#faf6ed;border:1px solid #e0d0b0;border-radius:12px;padding:28px;text-align:center;margin:24px 0">
          <p style="font-size:11px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:#9a8060;margin:0 0 12px">
            Your verification code
          </p>
          <p style="font-size:40px;font-weight:700;letter-spacing:14px;color:#0a2e1f;margin:0;font-family:monospace">
            ${otp}
          </p>
        </div>
        <p style="color:#6b7280;font-size:13px;text-align:center">
          This code expires in <strong>10 minutes</strong>. If you didn't create an account, you can safely ignore this email.
        </p>
      </div>`,
    text: `Your Tiuri Nails & Wigs verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you didn't create an account, ignore this email.`,
  }),

  /** @deprecated kept for password-reset flow only */
  verifyEmail: (name: string, link: string) => ({
    subject: 'Verify your email — Tiuri Nails & Wigs Parlour',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="color:#1a1a1a">Verify your email address</h1>
        <p>Hi${name ? ` ${name}` : ''},</p>
        <p>Thanks for registering with Tiuri Nails &amp; Wigs Parlour.
           Please verify your email address to activate your account.</p>
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:4px;margin:16px 0">
          Verify Email
        </a>
        <p style="color:#666;font-size:13px">
          This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
        </p>
      </div>`,
  }),

  welcome: (name: string) => ({
    subject: 'Your account is active — Tiuri Nails & Wigs Parlour',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="color:#1a1a1a">Welcome, ${name}!</h1>
        <p>Your email has been verified and your account is now active.</p>
        <a href="${env.FRONTEND_URL}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:4px">
          Go to App
        </a>
      </div>`,
  }),

  orderConfirmed: (orderNumber: string, total: number) => ({
    subject: `Order Confirmed — ${orderNumber}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="color:#1a1a1a">Order Confirmed!</h1>
        <p>Order <strong>${orderNumber}</strong> · KES ${total.toFixed(2)}</p>
        <p>We'll notify you once your order ships.</p>
      </div>`,
  }),

  bookingConfirmed: (bookingNumber: string, service: string, date: string, time: string) => ({
    subject: `Booking Confirmed — ${bookingNumber}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="color:#1a1a1a">Booking Confirmed!</h1>
        <p>Booking <strong>${bookingNumber}</strong></p>
        <p>${service} on <strong>${date}</strong> at <strong>${time}</strong></p>
      </div>`,
  }),

  passwordReset: (link: string) => ({
    subject: 'Reset Your Password',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="color:#1a1a1a">Reset Your Password</h1>
        <p>Click the button below to reset your password. This link expires in 1 hour.</p>
        <a href="${link}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:4px">
          Reset Password
        </a>
        <p style="color:#666;font-size:13px;margin-top:16px">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>`,
  }),

  orderStatusUpdate: (orderNumber: string, status: string) => ({
    subject: `Order Update — ${orderNumber}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h1 style="color:#1a1a1a">Order Status Update</h1>
        <p>Your order <strong>${orderNumber}</strong> is now <strong>${status}</strong>.</p>
      </div>`,
  }),
};
