import { uploadBuffer, uploadVideoBuffer } from '../config/cloudinary.js';
import { BadRequestError } from '../utils/errors.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska']);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export type UploadFolder = 'products' | 'services' | 'avatars' | 'reviews' | 'categories' | 'promotions' | 'homepage';

// Max dimensions per folder — keeps uploads appropriately sized before Cloudinary optimization
const FOLDER_DIMENSIONS: Record<UploadFolder, { width: number; height?: number }> = {
  products:   { width: 1200 },
  services:   { width: 900 },   // service cards: portrait, 3/4 ratio
  avatars:    { width: 256, height: 256 },
  reviews:    { width: 800 },
  categories: { width: 600 },
  promotions: { width: 1200 },
  homepage:   { width: 1600 }, // hero / philosophy / cta banners
};

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
  const { width, height } = FOLDER_DIMENSIONS[folder];

  return uploadBuffer(buffer, { folder: `wigsweb/${folder}`, width, height });
}

export async function uploadVideo(
  file: File,
  folder: UploadFolder = 'services'
): Promise<{ url: string; publicId: string; duration?: number }> {
  if (!ALLOWED_VIDEO_MIME.has(file.type)) {
    throw new BadRequestError('Only MP4, WebM, and MOV video formats are allowed');
  }
  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new BadRequestError('Video must be smaller than 50 MB');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return uploadVideoBuffer(buffer, { folder: `wigsweb/${folder}` });
}

