import { supabaseAdmin } from '../config/db.js';
import { uploadBuffer } from '../config/cloudinary.js';
import { deleteCloudinaryAsset } from '../config/cloudinary.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

export type HomepageSection = 'hero' | 'philosophy_nails' | 'philosophy_wigs' | 'cta';

export interface HomepageImage {
  id: string;
  section: HomepageSection;
  url: string;
  public_id: string;
  width: number | null;
  height: number | null;
  label: string | null;
  caption: string | null;
  href: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateHomepageImageInput {
  section: HomepageSection;
  file: File;
  label?: string;
  caption?: string;
  href?: string;
  sort_order?: number;
}

export interface UpdateHomepageImageInput {
  label?: string;
  caption?: string;
  href?: string;
  sort_order?: number;
  is_active?: boolean;
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB — hero/cta images can be larger

// Max width by section
const SECTION_WIDTHS: Record<HomepageSection, number> = {
  hero:             1600,
  philosophy_nails: 1200,
  philosophy_wigs:  1200,
  cta:              1400,
};

// ── Public: list all active images, optionally filtered by section ─────────
export async function listActive(section?: HomepageSection): Promise<HomepageImage[]> {
  let query = supabaseAdmin
    .from('homepage_images')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (section) query = query.eq('section', section);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as HomepageImage[];
}

// ── Admin: list ALL images (including inactive), optionally by section ──────
export async function listAll(section?: HomepageSection): Promise<HomepageImage[]> {
  let query = supabaseAdmin
    .from('homepage_images')
    .select('*')
    .order('section', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (section) query = query.eq('section', section);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as HomepageImage[];
}

// ── Admin: upload image to Cloudinary + insert DB row ───────────────────────
export async function create(input: CreateHomepageImageInput): Promise<HomepageImage> {
  const { section, file, label, caption, href, sort_order = 0 } = input;

  if (!ALLOWED_MIME.has(file.type)) {
    throw new BadRequestError('Only JPEG, PNG, WebP, and GIF images are allowed');
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new BadRequestError('Image must be smaller than 8 MB');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { url, publicId, width, height } = await uploadBuffer(buffer, {
    folder: `wigsweb/homepage/${section}`,
    width:  SECTION_WIDTHS[section],
  });

  const { data, error } = await supabaseAdmin
    .from('homepage_images')
    .insert({
      section,
      url,
      public_id: publicId,
      width,
      height,
      label:      label   ?? null,
      caption:    caption ?? null,
      href:       href    ?? null,
      sort_order,
    })
    .select()
    .single();

  if (error) throw error;
  return data as HomepageImage;
}

// ── Admin: update metadata (no image re-upload) ──────────────────────────────
export async function update(id: string, input: UpdateHomepageImageInput): Promise<HomepageImage> {
  const { data, error } = await supabaseAdmin
    .from('homepage_images')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new NotFoundError('Homepage image not found');
  return data as HomepageImage;
}

// ── Admin: delete from DB and Cloudinary ────────────────────────────────────
export async function remove(id: string): Promise<void> {
  // Fetch the public_id first so we can clean up Cloudinary
  const { data, error: fetchErr } = await supabaseAdmin
    .from('homepage_images')
    .select('public_id')
    .eq('id', id)
    .single();

  if (fetchErr || !data) throw new NotFoundError('Homepage image not found');

  // Delete the DB row first — if Cloudinary fails we can retry separately
  const { error: deleteErr } = await supabaseAdmin
    .from('homepage_images')
    .delete()
    .eq('id', id);

  if (deleteErr) throw deleteErr;

  // Best-effort Cloudinary cleanup — log but don't crash if it fails
  try {
    await deleteCloudinaryAsset(data.public_id);
  } catch (e) {
    console.error('[homepage-images] Cloudinary delete failed for', data.public_id, e);
  }
}
