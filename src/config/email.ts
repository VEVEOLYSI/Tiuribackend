import nodemailer from 'nodemailer';
import { env } from './env.js';
import { logger } from './logger.js';

// Single reusable SMTP transport — Brevo relay, no IP whitelist needed
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false, // STARTTLS on port 587
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

// Verify SMTP connection at startup
transport.verify().then(() => {
  logger.info('SMTP connected', { host: env.SMTP_HOST, port: env.SMTP_PORT });
}).catch((err: Error) => {
  logger.error('SMTP connection failed', { error: err.message });
});

export interface EmailPayload {
  to: { email: string; name?: string }[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const toAddresses = payload.to
    .map((r) => (r.name ? `"${r.name}" <${r.email}>` : r.email))
    .join(', ');

  try {
    await transport.sendMail({
      from: `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM}>`,
      to: toAddresses,
      subject: payload.subject,
      html: payload.html,
      ...(payload.text && { text: payload.text }),
      ...(payload.replyTo && { replyTo: payload.replyTo }),
    });

    logger.info('Email sent', {
      to: payload.to.map((r) => r.email),
      subject: payload.subject,
    });
  } catch (err) {
    logger.error('Email send failed', { error: err, subject: payload.subject });
    throw err;
  }
}

export const templates = {
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
