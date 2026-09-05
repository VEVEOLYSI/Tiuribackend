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

/**
 * `file.type` is just a header the client sends, so it proves nothing. Check
 * the leading bytes as well before handing anything to Cloudinary.
 */
function sniffImage(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'gif' | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  const gif = buf.subarray(0, 6).toString('ascii');
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
  return null;
}

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

  if (!sniffImage(buffer)) {
    throw new BadRequestError('That file is not a valid JPEG, PNG, WebP, or GIF image');
  }
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

