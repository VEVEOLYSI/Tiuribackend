import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export async function listActivePromotions() {
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from('promotions')
    .select('id, title, type, image_url, link_url, description, starts_at, ends_at, sort_order')
    .eq('is_active', true)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order('sort_order');
  return data ?? [];
}

export async function getActiveFlashSales() {
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from('promotions')
    .select(`
      id, title, starts_at, ends_at,
      flash_sale_items(id, sale_price, stock_limit, sold_count,
        products(id, name, slug, price, images))
    `)
    .eq('type', 'flash_sale')
    .eq('is_active', true)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .lte('starts_at', now);
  return data ?? [];
}

export async function createPromotion(
  actorId: string,
  payload: {
    title: string; type: string; imageUrl?: string; linkUrl?: string;
    description?: string; startsAt?: string; endsAt?: string;
    sortOrder?: number;
  }
) {
  const { data, error } = await supabaseAdmin
    .from('promotions')
    .insert({
      title: payload.title,
      type: payload.type,
      image_url: payload.imageUrl,
      link_url: payload.linkUrl,
      description: payload.description,
      starts_at: payload.startsAt,
      ends_at: payload.endsAt,
      sort_order: payload.sortOrder ?? 0,
      created_by: actorId,
    })
    .select()
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');
  return data;
}

export async function updatePromotion(id: string, payload: Partial<{
  title: string; imageUrl: string; linkUrl: string; description: string;
  startsAt: string; endsAt: string; isActive: boolean; sortOrder: number;
}>) {
  const updates: Record<string, unknown> = {};
  if (payload.title !== undefined) updates.title = payload.title;
  if (payload.imageUrl !== undefined) updates.image_url = payload.imageUrl;
  if (payload.linkUrl !== undefined) updates.link_url = payload.linkUrl;
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.startsAt !== undefined) updates.starts_at = payload.startsAt;
  if (payload.endsAt !== undefined) updates.ends_at = payload.endsAt;
  if (payload.isActive !== undefined) updates.is_active = payload.isActive;
  if (payload.sortOrder !== undefined) updates.sort_order = payload.sortOrder;

  const { data, error } = await supabaseAdmin
    .from('promotions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error || !data) throw new NotFoundError('Promotion');
  return data;
}

export async function addFlashSaleItem(
  promotionId: string,
  payload: { productId: string; salePrice: number; stockLimit?: number }
) {
  const { data, error } = await supabaseAdmin
    .from('flash_sale_items')
    .insert({
      promotion_id: promotionId,
      product_id: payload.productId,
      sale_price: payload.salePrice,
      stock_limit: payload.stockLimit,
    })
    .select()
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Add item failed');
  return data;
}
