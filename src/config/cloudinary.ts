import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';
import { logger } from './logger.js';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };

interface UploadOptions {
  folder?: string;
  publicId?: string;
  width?: number;
  height?: number;
}

export async function uploadBuffer(
  buffer: Buffer,
  opts: UploadOptions = {}
): Promise<{ url: string; publicId: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const transformation: Record<string, unknown>[] = [
      { quality: 'auto', fetch_format: 'auto' },
    ];
    if (opts.width || opts.height) {
      transformation.push({ width: opts.width, height: opts.height, crop: 'limit' });
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder ?? 'wigsweb',
        public_id: opts.publicId,
        transformation,
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) {
          logger.error('Cloudinary upload failed', { error });
          reject(error ?? new Error('Cloudinary upload returned no result'));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
        });
      }
    );
    stream.end(buffer);
  });
}

export async function deleteCloudinaryAsset(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}
