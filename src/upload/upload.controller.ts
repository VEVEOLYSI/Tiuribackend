import type { Context } from 'hono';
import { z } from 'zod';
import * as svc from './upload.service.js';
import type { UploadFolder } from './upload.service.js';
import { ok } from '../utils/response.js';
import { BadRequestError, ForbiddenError } from '../utils/errors.js';
import type { AppEnv } from '../types/index.js';

const folderSchema = z.enum(['products', 'services', 'avatars', 'reviews', 'categories', 'promotions', 'homepage']);

// Folders that hold shop content rather than something the customer owns.
// Left open to any signed-in account these let a customer push arbitrary
// images into the catalogue and burn the shop's Cloudinary quota.
const STAFF_ONLY_FOLDERS = new Set<UploadFolder>([
  'products', 'services', 'categories', 'promotions', 'homepage',
]);

function assertMayWriteFolder(c: Context<AppEnv>, folder: UploadFolder) {
  if (!STAFF_ONLY_FOLDERS.has(folder)) return;
  const role = c.get('user')?.role;
  if (role !== 'admin' && role !== 'staff') {
    throw new ForbiddenError('You cannot upload to this folder');
  }
}

export const upload = async (c: Context<AppEnv>) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  const folder = folderSchema.parse(body['folder'] ?? 'products') as UploadFolder;

  if (!(file instanceof File)) throw new BadRequestError('No file provided');
  assertMayWriteFolder(c, folder);

  const result = await svc.uploadImage(file, folder);
  return ok(c, result, 201);
};

export const uploadVideo = async (c: Context<AppEnv>) => {
  const body = await c.req.parseBody();
  const file = body['file'];
  const folder = folderSchema.parse(body['folder'] ?? 'services') as UploadFolder;

  if (!(file instanceof File)) throw new BadRequestError('No file provided');
  assertMayWriteFolder(c, folder);

  const result = await svc.uploadVideo(file, folder);
  return ok(c, result, 201);
};

