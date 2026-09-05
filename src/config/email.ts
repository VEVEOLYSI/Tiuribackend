import { Resend } from 'resend';
import { env } from './env.js';
import { logger } from './logger.js';
import {
  shell, button, codePanel, factTable, note, paragraph, esc, money, OK,
} from './email-layout.js';

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

// ─── Templates ────────────────────────────────────────────────────────────────
// Every template goes through `shell` so the whole set looks like one sender,
// and every interpolated value goes through `esc` because names, service names
// and order numbers all originate outside this file.

const greet = (name: string) => {
  const first = String(name ?? '').trim().split(' ')[0];
  return first ? `Hi ${esc(first)},` : 'Hi there,';
};

export const templates = {
  otpVerification: (name: string, otp: string) => ({
    subject: 'Your verification code — Tiuri Nails & Wigs Parlour',
    html: shell({
      preheader: `${otp} is your Tiuri verification code. It expires in 10 minutes.`,
      heading: 'Verify your email',
      body:
        paragraph(greet(name)) +
        paragraph('Enter this code to finish setting up your account.') +
        codePanel(otp, 'Verification code') +
        note('The code expires in <strong>10 minutes</strong>. If you did not create an account, you can ignore this email.'),
    }),
    text: `Your Tiuri Nails & Wigs verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you didn't create an account, ignore this email.`,
  }),

  /** @deprecated kept for the password-reset flow only */
  verifyEmail: (name: string, link: string) => ({
    subject: 'Verify your email — Tiuri Nails & Wigs Parlour',
    html: shell({
      preheader: 'Confirm your email address to activate your Tiuri account.',
      heading: 'Verify your email address',
      body:
        paragraph(greet(name)) +
        paragraph('Confirm your email address to activate your account.') +
        button(link, 'Verify email') +
        note('This link expires in 24 hours. If you did not create an account, you can ignore this email.'),
    }),
    text: `Verify your email address: ${link}\n\nThis link expires in 24 hours.`,
  }),

  welcome: (name: string) => ({
    subject: 'Your account is active — Tiuri Nails & Wigs Parlour',
    html: shell({
      preheader: 'Your Tiuri account is ready — book a set or shop the shelf.',
      heading: 'You are all set',
      body:
        paragraph(greet(name)) +
        paragraph('Your email is verified and your account is active. You can book a nail appointment, or browse the wigs and have one held for collection.') +
        button(env.FRONTEND_URL, 'Book an appointment') +
        note(`Prefer to shop first? <a href="${esc(env.FRONTEND_URL)}/products" style="color:#55534e">Browse the wigs</a>.`),
    }),
    text: `Your Tiuri account is active.\n\nBook an appointment: ${env.FRONTEND_URL}/bookings\nShop wigs: ${env.FRONTEND_URL}/products`,
  }),

  orderConfirmed: (orderNumber: string, total: number) => ({
    subject: `Order confirmed — ${orderNumber}`,
    html: shell({
      preheader: `We have your order ${orderNumber}. We will let you know when it ships.`,
      heading: 'Order confirmed',
      body:
        paragraph('Thanks — your payment went through and your order is being prepared.') +
        factTable([
          ['Order number', esc(orderNumber)],
          ['Total paid', money(total)],
          ['Status', `<span style="color:${OK}">Confirmed</span>`],
        ]) +
        button(`${env.FRONTEND_URL}/account/orders`, 'View your order') +
        note('We will email you again as soon as it ships.'),
    }),
    text: `Order ${orderNumber} confirmed.\nTotal paid: ${money(total)}\n\nView your order: ${env.FRONTEND_URL}/account/orders`,
  }),

  bookingConfirmed: (
    bookingNumber: string,
    service: string,
    date: string,
    time: string,
    customerName = '',
    depositAmount = 0,
    balanceAmount = 0,
  ) => {
    // "2026-06-08" → "Sunday, 8 June 2026"
    const fmtDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-KE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    // "09:30:00" → "9:30 AM"
    const [hStr, mStr] = time.split(':');
    const h = parseInt(hStr, 10);
    const fmtTime = `${h % 12 || 12}:${mStr} ${h >= 12 ? 'PM' : 'AM'}`;

    const rows: Array<[string, string]> = [
      ['Service', esc(service)],
      ['Date', esc(fmtDate)],
      ['Time', esc(fmtTime)],
      ['Reference', `#${esc(bookingNumber)}`],
    ];
    if (depositAmount > 0) {
      rows.push(['Deposit paid', `<span style="color:${OK}">${money(depositAmount)}</span>`]);
      rows.push(['Balance at the salon', money(balanceAmount)]);
    }

    return {
      subject: `Booking confirmed — ${fmtDate}, ${fmtTime}`,
      html: shell({
        preheader: `${service} on ${fmtDate} at ${fmtTime}. Reference #${bookingNumber}.`,
        heading: 'Your booking is confirmed',
        body:
          paragraph(greet(customerName)) +
          paragraph('Your chair is booked. Here are the details.') +
          factTable(rows) +
          paragraph('Please arrive 5 to 10 minutes early. To reschedule, let us know at least 24 hours ahead.') +
          button(`${env.FRONTEND_URL}/account/bookings`, 'View your booking'),
      }),
      text: `Hi ${customerName || 'there'},\n\nYour booking is confirmed.\n\nService: ${service}\nDate: ${fmtDate}\nTime: ${fmtTime}\nRef: #${bookingNumber}\n${depositAmount > 0 ? `\nDeposit paid: ${money(depositAmount)}\nBalance at salon: ${money(balanceAmount)}\n` : ''}\nJewel Complex, Room 220, 2nd Floor, TRM Drive, Nairobi\n\nPlease arrive 5–10 minutes early. To reschedule, contact us at least 24 hours in advance.\n\n— Tiuri Nails & Wigs Parlour`,
    };
  },

  passwordReset: (link: string) => ({
    subject: 'Reset your password — Tiuri Nails & Wigs Parlour',
    html: shell({
      preheader: 'Reset your Tiuri password. This link expires in 1 hour.',
      heading: 'Reset your password',
      body:
        paragraph('Use the button below to choose a new password.') +
        button(link, 'Reset password') +
        note('This link expires in <strong>1 hour</strong>. If you did not ask to reset your password, you can ignore this email — nothing has changed.'),
    }),
    text: `Reset your Tiuri password: ${link}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
  }),

  orderStatusUpdate: (orderNumber: string, status: string) => ({
    subject: `Order update — ${orderNumber}`,
    html: shell({
      preheader: `Order ${orderNumber} is now ${status}.`,
      heading: 'Your order has moved on',
      body:
        factTable([
          ['Order number', esc(orderNumber)],
          ['Status', `<span style="color:${OK}">${esc(status)}</span>`],
        ]) +
        button(`${env.FRONTEND_URL}/account/orders`, 'Track your order'),
    }),
    text: `Order ${orderNumber} is now ${status}.\n\nTrack it: ${env.FRONTEND_URL}/account/orders`,
  }),

  /** Internal — the shop's own copy of a contact-form submission. */
  contactMessage: (input: {
    name: string; email: string; phone?: string; subject: string; message: string;
  }) => ({
    subject: `[Contact] ${input.subject}`,
    html: shell({
      preheader: `${input.name} sent a message about ${input.subject}.`,
      heading: 'New contact message',
      body:
        factTable([
          ['Name', esc(input.name)],
          ['Email', `<a href="mailto:${esc(input.email)}" style="color:#55534e">${esc(input.email)}</a>`],
          ...(input.phone ? [['Phone', esc(input.phone)] as [string, string]] : []),
          ['Subject', esc(input.subject)],
        ]) +
        `<div style="margin:24px 0;padding:20px;background:#f4f4f2;border:1px solid #dedcd7;border-radius:8px">
           <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#8b8881;margin-bottom:10px">Message</div>
           <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#171614;white-space:pre-wrap">${esc(input.message)}</div>
         </div>` +
        note(`Reply to this email to answer ${esc(input.name)} directly.`),
    }),
    text: `New contact message from ${input.name} (${input.email})${input.phone ? ` · ${input.phone}` : ''}\n\nSubject: ${input.subject}\n\n${input.message}`,
  }),
};
