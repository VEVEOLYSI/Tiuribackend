import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './client-notes.service.js';
import { ok, paginated, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createSchema = z.object({
  clientId:   z.string().uuid(),
  bookingId:  z.string().uuid().optional(),
  note:       z.string().min(1).max(2000),
  isFlagged:  z.boolean().optional(),
});

const updateSchema = z.object({
  note:      z.string().min(1).max(2000).optional(),
  isFlagged: z.boolean().optional(),
});

export const create = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = createSchema.parse(await c.req.json());
  return ok(c, await svc.createNote(user.id, body), 201);
};

export const listForClient = async (c: Context<AppEnv>) => {
  const clientId = c.req.param('clientId')!;
  const q = c.req.query() as { page?: string; limit?: string; flaggedOnly?: string };
  const result = await svc.listClientNotes(clientId, q);
  return paginated(c, result.data, result.meta);
};

export const listAll = async (c: Context<AppEnv>) => {
  const q = c.req.query() as { page?: string; limit?: string; clientId?: string; flaggedOnly?: string };
  const result = await svc.getAllNotes(q);
  return paginated(c, result.data, result.meta);
};

export const update = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const body = updateSchema.parse(await c.req.json());
  return ok(c, await svc.updateNote(user.id, c.req.param('id')!, body, user.role === 'admin'));
};

export const remove = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  await svc.deleteNote(user.id, c.req.param('id')!, user.role === 'admin');
  return noContent(c);
};
