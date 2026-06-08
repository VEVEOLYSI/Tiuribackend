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

  bookingConfirmed: (
    bookingNumber: string,
    service: string,
    date: string,
    time: string,
    customerName = '',
    depositAmount = 0,
    balanceAmount = 0,
  ) => {
    // Format date: "2026-06-08" → "Sunday, 8 June 2026"
    const fmtDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-KE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    // Format time: "09:30:00" → "9:30 AM"
    const [hStr, mStr] = time.split(':');
    const h = parseInt(hStr, 10);
    const fmtTime = `${h % 12 || 12}:${mStr} ${h >= 12 ? 'PM' : 'AM'}`;

    const firstName = customerName.trim().split(' ')[0] || 'there';
    const fmtKes = (n: number) =>
      `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return {
      subject: `✨ You're all booked! — ${service} on ${fmtDate}`,
      html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#0a2e1f 0%,#1a5c3a 100%);padding:36px 32px;text-align:center">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:#c9a227">
            Tiuri Nails &amp; Wigs Parlour
          </p>
          <h1 style="margin:0;font-size:28px;font-weight:800;color:#ffffff;line-height:1.2">
            You&rsquo;re all booked! ✨
          </h1>
          <p style="margin:12px 0 0;font-size:15px;color:#a8d5b5">
            We can&rsquo;t wait to make you feel amazing.
          </p>
        </td>
      </tr>

      <!-- Greeting -->
      <tr>
        <td style="padding:32px 32px 0">
          <p style="margin:0;font-size:16px;color:#374151;line-height:1.6">
            Hi <strong style="color:#0a2e1f">${firstName}</strong> 👋
          </p>
          <p style="margin:12px 0 0;font-size:15px;color:#6b7280;line-height:1.7">
            Your appointment is confirmed and your spot is reserved. Here&rsquo;s everything you need to know before your visit.
          </p>
        </td>
      </tr>

      <!-- Booking details card -->
      <tr>
        <td style="padding:24px 32px">
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#faf6ed;border:1.5px solid #e8d9b8;border-radius:16px;overflow:hidden">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #e8d9b8">
                <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#c9a227">
                  Your Appointment
                </p>
                <p style="margin:0;font-size:20px;font-weight:800;color:#0a2e1f">${service}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:16px 24px;border-bottom:1px solid #e8d9b8;width:50%">
                      <p style="margin:0 0 3px;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#9a8060">📅 Date</p>
                      <p style="margin:0;font-size:14px;font-weight:600;color:#0a2e1f">${fmtDate}</p>
                    </td>
                    <td style="padding:16px 24px;border-bottom:1px solid #e8d9b8;border-left:1px solid #e8d9b8">
                      <p style="margin:0 0 3px;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#9a8060">⏰ Time</p>
                      <p style="margin:0;font-size:14px;font-weight:600;color:#0a2e1f">${fmtTime}</p>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="2" style="padding:16px 24px">
                      <p style="margin:0 0 3px;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#9a8060">🔖 Booking Reference</p>
                      <p style="margin:0;font-size:14px;font-weight:700;color:#0a2e1f;font-family:monospace;letter-spacing:0.06em">#${bookingNumber}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      ${depositAmount > 0 ? `
      <!-- Payment summary -->
      <tr>
        <td style="padding:0 32px 24px">
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#0a2e1f;border-radius:16px;overflow:hidden">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.1)">
                <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#c9a227">
                  💳 Payment Summary
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-bottom:1px solid rgba(255,255,255,0.08)">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td><p style="margin:0;font-size:13px;color:#a8d5b5">Deposit paid ✅</p></td>
                    <td align="right"><p style="margin:0;font-size:13px;font-weight:700;color:#ffffff">${fmtKes(depositAmount)}</p></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td><p style="margin:0;font-size:13px;color:#a8d5b5">Balance payable at salon</p></td>
                    <td align="right"><p style="margin:0;font-size:15px;font-weight:800;color:#c9a227">${fmtKes(balanceAmount)}</p></td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>` : ''}

      <!-- Location -->
      <tr>
        <td style="padding:0 32px 24px">
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:16px;padding:20px 24px">
            <tr>
              <td>
                <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#9a8060">📍 Where to find us</p>
                <p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#0a2e1f">Jewel Complex, Room 220</p>
                <p style="margin:0 0 12px;font-size:13px;color:#6b7280">2nd Floor, TRM Drive, Nairobi</p>
                <a href="https://www.google.com/maps/search/?api=1&query=Tiuri+Nails+%26+Wigs+Parlour,+Jewel+Complex,+Room+220,+2nd+Floor+TRM+Dr,+Nairobi"
                   style="display:inline-block;padding:8px 16px;background:#0a2e1f;color:#ffffff;text-decoration:none;border-radius:8px;font-size:12px;font-weight:600">
                  Get Directions →
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Tips -->
      <tr>
        <td style="padding:0 32px 24px">
          <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#374151">Before your visit 💡</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:6px 0">
                <p style="margin:0;font-size:13px;color:#6b7280">✔ Please arrive <strong>5–10 minutes early</strong> so we can get started on time.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0">
                <p style="margin:0;font-size:13px;color:#6b7280">✔ Need to reschedule? Contact us <strong>at least 24 hours</strong> before your appointment.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:6px 0">
                <p style="margin:0;font-size:13px;color:#6b7280">✔ Have questions? We&rsquo;re here to help — reply to this email or WhatsApp us.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- CTA -->
      <tr>
        <td style="padding:0 32px 32px;text-align:center">
          <p style="margin:0 0 20px;font-size:15px;color:#6b7280">We&rsquo;re so excited to see you, ${firstName}! 💅</p>
          <a href="${env.FRONTEND_URL}/account/bookings"
             style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#f0d878,#c9a227);color:#0a2e1f;text-decoration:none;border-radius:12px;font-size:14px;font-weight:800;letter-spacing:0.03em">
            View My Booking
          </a>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f5f0e8;padding:24px 32px;text-align:center;border-top:1px solid #e8d9b8">
          <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#0a2e1f">Tiuri Nails &amp; Wigs Parlour</p>
          <p style="margin:0;font-size:11px;color:#9a8060">Jewel Complex, Room 220, 2nd Floor TRM Drive, Nairobi</p>
          <p style="margin:8px 0 0;font-size:11px;color:#c9b99a">
            You received this because you made a booking with us.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`,
      text: `Hi ${firstName},\n\nYour booking is confirmed!\n\nService: ${service}\nDate: ${fmtDate}\nTime: ${fmtTime}\nRef: #${bookingNumber}\n${depositAmount > 0 ? `\nDeposit paid: ${fmtKes(depositAmount)}\nBalance at salon: ${fmtKes(balanceAmount)}\n` : ''}\nLocation: Jewel Complex, Room 220, 2nd Floor TRM Drive, Nairobi\n\nPlease arrive 5–10 minutes early. To reschedule, contact us at least 24 hours in advance.\n\nWe can't wait to see you!\n— Tiuri Nails & Wigs Parlour`,
    };
  },

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
