import { supabaseAdmin } from '../config/db.js';
import { BadRequestError } from '../utils/errors.js';

export async function getWishlist(userId: string) {
  const { data } = await supabaseAdmin
    .from('wishlist_items')
    .select('id, created_at, products(id, name, slug, price, compare_at_price, images, stock)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function addToWishlist(userId: string, productId: string) {
  const { data: product } = await supabaseAdmin
    .from('products')
    .select('id')
    .eq('id', productId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .single();
  if (!product) throw new BadRequestError('Product not found');

  const { data, error } = await supabaseAdmin
    .from('wishlist_items')
    .upsert({ user_id: userId, product_id: productId }, { onConflict: 'user_id,product_id' })
    .select('id')
    .single();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Add failed');
  return data;
}

export async function removeFromWishlist(userId: string, productId: string) {
  await supabaseAdmin
    .from('wishlist_items')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId);
}
