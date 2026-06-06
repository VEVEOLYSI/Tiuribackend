import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './blog.service.js';
import { ok, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createSchema = z.object({
  title:       z.string().min(1),
  slug:        z.string().min(1).regex(/^[a-z0-9-]+$/),
  content:     z.string().min(1),
  excerpt:     z.string().optional(),
  coverImage:  z.string().url().optional(),
  isPublished: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export const list = async (c: Context<AppEnv>) => {
  const posts = await svc.listPosts({ publishedOnly: true });
  return ok(c, posts);
};

export const adminList = async (c: Context<AppEnv>) => {
  const posts = await svc.listPosts({ publishedOnly: false });
  return ok(c, posts);
};

export const getBySlug = async (c: Context<AppEnv>) => {
  const post = await svc.getPostBySlug(c.req.param('slug'));
  return ok(c, post);
};

export const create = async (c: Context<AppEnv>) => {
  const body = await c.req.json();
  const payload = createSchema.parse(body);
  const user = c.get('user');
  const post = await svc.createPost({ ...payload, authorId: user.id });
  return ok(c, post, 201);
};

export const update = async (c: Context<AppEnv>) => {
  const body = await c.req.json();
  const payload = updateSchema.parse(body);
  const post = await svc.updatePost(c.req.param('id'), payload);
  return ok(c, post);
};

export const remove = async (c: Context<AppEnv>) => {
  await svc.deletePost(c.req.param('id'));
  return noContent(c);
};
