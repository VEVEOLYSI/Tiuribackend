import type { Context } from 'hono';
import * as svc from './notifications.service.js';
import { ok, noContent, paginated } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

export const list = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const result = await svc.listNotifications(user.id, c.req.query());
  return paginated(c, result.data, result.meta);
};

export const markRead = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  const { id } = c.req.param();
  await svc.markRead(user.id, id);
  return noContent(c);
};

export const markAllRead = async (c: Context<AppEnv>) => {
  const user = c.get('user')!;
  await svc.markAllRead(user.id);
  return noContent(c);
};
