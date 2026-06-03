import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

export async function listReviews(
  targetType: 'product' | 'service',
  targetId: string,
  query: { page?: string; limit?: string }
) {
  const { page, limit, offset } = parsePage(query);

  const field = targetType === 'product' ? 'product_id' : 'service_id';

  const { data, count } = await supabaseAdmin
    .from('reviews')
    .select(
      'id, rating, title, comment, images, is_verified_purchase, created_at, profiles(name, avatar_url)',
      { count: 'exact' }
    )
    .eq(field, targetId)
    .eq('is_approved', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function createReview(
  userId: string,
  payload: {
    targetType: 'product' | 'service';
    productId?: string;
    serviceId?: string;
    orderItemId?: string;
    bookingId?: string;
    rating: number;
    title?: string;
    comment?: string;
    images?: unknown[];
  }
) {
  // Prevent duplicate reviews
  const field = payload.targetType === 'product' ? 'product_id' : 'service_id';
  const targetId = payload.productId ?? payload.serviceId;

  const { data: existing } = await supabaseAdmin
    .from('reviews')
    .select('id')
    .eq('user_id', userId)
    .eq(field, targetId!)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) throw new BadRequestError('You have already reviewed this item');

  const { data, error } = await supabaseAdmin
    .from('reviews')
    .insert({
      user_id: userId,
      target_type: payload.targetType,
      product_id: payload.productId ?? null,
      service_id: payload.serviceId ?? null,
      order_item_id: payload.orderItemId ?? null,
      booking_id: payload.bookingId ?? null,
      rating: payload.rating,
      title: payload.title,
      comment: payload.comment,
      images: payload.images ?? [],
    })
    .select('id, rating, is_verified_purchase')
    .single();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Review creation failed');
  return data;
}

export async function updateReview(
  userId: string,
  reviewId: string,
  payload: { rating?: number; title?: string; comment?: string }
) {
  const { data: existing } = await supabaseAdmin
    .from('reviews')
    .select('user_id, is_approved')
    .eq('id', reviewId)
    .is('deleted_at', null)
    .single();

  if (!existing) throw new NotFoundError('Review');
  if (existing.user_id !== userId) throw new ForbiddenError();
  if (existing.is_approved) throw new BadRequestError('Approved reviews cannot be edited');

  const { data, error } = await supabaseAdmin
    .from('reviews')
    .update({ ...payload })
    .eq('id', reviewId)
    .select('id, rating, title, comment, updated_at')
    .single();

  if (error || !data) throw new BadRequestError('Update failed');
  return data;
}

export async function deleteReview(userId: string, reviewId: string, isAdmin = false) {
  const { data: existing } = await supabaseAdmin
    .from('reviews')
    .select('user_id')
    .eq('id', reviewId)
    .is('deleted_at', null)
    .single();

  if (!existing) throw new NotFoundError('Review');
  if (!isAdmin && existing.user_id !== userId) throw new ForbiddenError();

  await supabaseAdmin
    .from('reviews')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', reviewId);
}
