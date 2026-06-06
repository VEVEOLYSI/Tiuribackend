import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './upload.service.js';
import type { UploadFolder } from './upload.service.js';
import { ok } from '../utils/response.js';
import { BadRequestError } from '../utils/errors.js';
import type { AppEnv } from '../types/index.js';

const folderSchema = z.enum(['products', 'services', 'avatars', 'reviews', 'categories', 'promotions']);

export const upload = async (c: Context<AppEnv>) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  const folder = folderSchema.parse(body['folder'] ?? 'products') as UploadFolder;

  if (!(file instanceof File)) throw new BadRequestError('No file provided');

  const result = await svc.uploadImage(file, folder);
  return ok(c, result, 201);
};
