import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './homepage-images.service.js';
import type { HomepageSection } from './homepage-images.service.js';
import { ok, noContent } from '../utils/response.js';
import { BadRequestError } from '../utils/errors.js';
import type { AppEnv } from '../types/index.js';

const sectionSchema = z.enum(['hero', 'philosophy_nails', 'philosophy_wigs', 'cta']);

// ── GET /api/v1/homepage-images  (public) ────────────────────────────────────
// Returns active images grouped by section: { hero: [...], philosophy_nails: [...], ... }
export const listPublic = async (c: Context<AppEnv>) => {
  const sectionParam = c.req.query('section');
  const section = sectionParam
    ? (sectionSchema.parse(sectionParam) as HomepageSection)
    : undefined;

  const images = await svc.listActive(section);

  // Group by section for convenience
  const grouped: Record<string, svc.HomepageImage[]> = {};
  for (const img of images) {
    if (!grouped[img.section]) grouped[img.section] = [];
    grouped[img.section].push(img);
  }

  return ok(c, grouped);
};

// ── GET /api/v1/homepage-images/admin  (admin) ───────────────────────────────
export const listAdmin = async (c: Context<AppEnv>) => {
  const sectionParam = c.req.query('section');
  const section = sectionParam
    ? (sectionSchema.parse(sectionParam) as HomepageSection)
    : undefined;

  const images = await svc.listAll(section);

  const grouped: Record<string, svc.HomepageImage[]> = {};
  for (const img of images) {
    if (!grouped[img.section]) grouped[img.section] = [];
    grouped[img.section].push(img);
  }

  return ok(c, grouped);
};

// ── POST /api/v1/homepage-images  (admin) ────────────────────────────────────
export const create = async (c: Context<AppEnv>) => {
  const body = await c.req.parseBody();

  const file = body['file'];
  if (!(file instanceof File)) throw new BadRequestError('No file provided');

  const section = sectionSchema.parse(body['section']) as HomepageSection;

  const label      = typeof body['label']      === 'string' ? body['label']      : undefined;
  const caption    = typeof body['caption']    === 'string' ? body['caption']    : undefined;
  const href       = typeof body['href']       === 'string' ? body['href']       : undefined;
  const sortRaw    = typeof body['sort_order'] === 'string' ? body['sort_order'] : '0';
  const sort_order = parseInt(sortRaw, 10) || 0;

  const result = await svc.create({ section, file, label, caption, href, sort_order });
  return ok(c, result, 201);
};

// ── PATCH /api/v1/homepage-images/:id  (admin) ───────────────────────────────
export const update = async (c: Context<AppEnv>) => {
  const id = c.req.param('id') as string;

  const patchSchema = z.object({
    label:       z.string().optional(),
    caption:     z.string().optional(),
    href:        z.string().optional(),
    sort_order:  z.coerce.number().int().optional(),
    is_active:   z.coerce.boolean().optional(),
  });

  const body  = await c.req.json();
  const input = patchSchema.parse(body);

  const result = await svc.update(id, input);
  return ok(c, result);
};

// ── DELETE /api/v1/homepage-images/:id  (admin) ──────────────────────────────
export const remove = async (c: Context<AppEnv>) => {
  const id = c.req.param('id') as string;
  await svc.remove(id);
  return noContent(c);
};
