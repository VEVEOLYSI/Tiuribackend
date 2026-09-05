import type { Context } from 'hono';
import { z } from 'zod';
import { sendEmail, templates } from '../config/email.js';
import { ok } from '../utils/response.js';
import { env } from '../config/env.js';
import type { AppEnv } from '../types/index.js';

const schema = z.object({
  name:    z.string().min(1).max(120),
  email:   z.string().email(),
  phone:   z.string().max(40).optional(),
  subject: z.string().min(1).max(200),
  message: z.string().min(10).max(5000),
});

/**
 * The display name lands inside an email header, so anything that could break
 * out of the quoted string — quotes, angle brackets, newlines — is stripped
 * rather than escaped. The address itself is already validated as an email.
 */
function headerSafeName(name: string): string {
  return name.replace(/["<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 78);
}

export const sendContact = async (c: Context<AppEnv>) => {
  const body = await c.req.json();
  const input = schema.parse(body);

  // The template escapes every field — this message is assembled entirely
  // from stranger-supplied input and is read by the shop owner.
  await sendEmail({
    to: [{ email: env.EMAIL_FROM, name: 'Tiuri Nails & Wigs Parlour' }],
    replyTo: `"${headerSafeName(input.name)}" <${input.email}>`,
    ...templates.contactMessage(input),
  });

  return ok(c, { sent: true });
};
