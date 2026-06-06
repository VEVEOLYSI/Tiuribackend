import type { Context } from 'hono';
import { z } from 'zod';
import { sendEmail } from '../config/email.js';
import { ok } from '../utils/response.js';
import { env } from '../config/env.js';
import type { AppEnv } from '../types/index.js';

const schema = z.object({
  name:    z.string().min(1).max(120),
  email:   z.string().email(),
  phone:   z.string().optional(),
  subject: z.string().min(1).max(200),
  message: z.string().min(10).max(5000),
});

export const sendContact = async (c: Context<AppEnv>) => {
  const body = await c.req.json();
  const { name, email, phone, subject, message } = schema.parse(body);

  await sendEmail({
    to: [{ email: env.EMAIL_FROM, name: 'Tiuri Nails & Wigs Parlour' }],
    subject: `[Contact] ${subject}`,
    replyTo: `"${name}" <${email}>`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
        <div style="background:#0a2e1f;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;color:#f0d878;font-size:20px">New Contact Message</h1>
          <p style="margin:4px 0 0;color:rgba(240,216,120,0.6);font-size:13px">
            Tiuri Nails &amp; Wigs Parlour
          </p>
        </div>
        <div style="background:#faf6ed;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e0d0b0">
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            <tr>
              <td style="padding:8px 0;color:#9a8060;font-size:13px;width:80px">Name</td>
              <td style="padding:8px 0;font-weight:600">${name}</td>
            </tr>
            <tr>
              <td style="padding:8px 0;color:#9a8060;font-size:13px">Email</td>
              <td style="padding:8px 0">
                <a href="mailto:${email}" style="color:#0a2e1f">${email}</a>
              </td>
            </tr>
            ${phone ? `<tr>
              <td style="padding:8px 0;color:#9a8060;font-size:13px">Phone</td>
              <td style="padding:8px 0">${phone}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:8px 0;color:#9a8060;font-size:13px">Subject</td>
              <td style="padding:8px 0;font-weight:600">${subject}</td>
            </tr>
          </table>
          <div style="background:#fff;border:1px solid #e0d0b0;border-radius:8px;padding:20px">
            <p style="margin:0;font-size:13px;color:#9a8060;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px">Message</p>
            <p style="margin:0;line-height:1.7;white-space:pre-wrap">${message}</p>
          </div>
          <p style="margin-top:24px;font-size:12px;color:#9a8060">
            Reply directly to this email to respond to ${name}.
          </p>
        </div>
      </div>`,
    text: `New contact message from ${name} (${email})${phone ? ` · ${phone}` : ''}\n\nSubject: ${subject}\n\n${message}`,
  });

  return ok(c, { sent: true });
};
