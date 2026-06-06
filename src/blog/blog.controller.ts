import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './blog.service.js';
import { ok, noContent } from '../utils/response.js';
import { BadRequestError } from '../utils/errors.js';
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
  const slug = c.req.param('slug');
  if (!slug) throw new BadRequestError('Slug is required');
  const post = await svc.getPostBySlug(slug);
  return ok(c, post);
};

export const create = async (c: Context<AppEnv>) => {
  const body = await c.req.json();
  const payload = createSchema.parse(body);
  const user = c.get('user');
  if (!user) throw new BadRequestError('Unauthorized');
  const post = await svc.createPost({ ...payload, authorId: user.id });
  return ok(c, post, 201);
};

export const update = async (c: Context<AppEnv>) => {
  const body = await c.req.json();
  const payload = updateSchema.parse(body);
  const id = c.req.param('id');
  if (!id) throw new BadRequestError('ID is required');
  const post = await svc.updatePost(id, payload);
  return ok(c, post);
};

export const remove = async (c: Context<AppEnv>) => {
  const id = c.req.param('id');
  if (!id) throw new BadRequestError('ID is required');
  await svc.deletePost(id);
  return noContent(c);
};
