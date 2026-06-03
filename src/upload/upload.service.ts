import { uploadBuffer } from '../config/cloudinary.js';
import { BadRequestError } from '../utils/errors.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export type UploadFolder = 'products' | 'avatars' | 'reviews' | 'categories' | 'promotions';

export async function uploadImage(
  file: File,
  folder: UploadFolder
): Promise<{ url: string; publicId: string; width: number; height: number }> {
  if (!ALLOWED_MIME.has(file.type)) {
    throw new BadRequestError('Only JPEG, PNG, WebP, and GIF images are allowed');
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new BadRequestError('Image must be smaller than 5 MB');
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const width = folder === 'avatars' ? 256 : 1200;
  const height = folder === 'avatars' ? 256 : undefined;

  return uploadBuffer(buffer, { folder: `wigsweb/${folder}`, width, height });
}
