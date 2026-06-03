import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

const CART_TTL_HOURS = 72;

async function ensureCart(userId: string) {
  const { data: existing } = await supabaseAdmin
    .from('carts')
    .select('id, expires_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existing) return existing.id;

  const expires = new Date(Date.now() + CART_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('carts')
    .insert({ user_id: userId, expires_at: expires })
    .select('id')
    .single();

  if (error || !data) throw new BadRequestError('Cannot create cart');
  return data.id;
}

export async function getCart(userId: string) {
  const cartId = await ensureCart(userId);

  const { data } = await supabaseAdmin
    .from('cart_items')
    .select(`
      id, quantity, unit_price, notes, variant_id,
      products(id, name, slug, images, stock),
      services(id, name, slug, price)
    `)
    .eq('cart_id', cartId);

  return { cartId, items: data ?? [] };
}

export async function addItem(
  userId: string,
  payload: {
    productId?: string;
    serviceId?: string;
    variantId?: string;
    quantity: number;
    notes?: string;
  }
) {
  if (!payload.productId && !payload.serviceId) {
    throw new BadRequestError('Provide productId or serviceId');
  }

  const cartId = await ensureCart(userId);

  // Look up current unit price
  let unitPrice = 0;
  if (payload.productId) {
    const { data } = await supabaseAdmin
      .from('products')
      .select('price, variants, stock')
      .eq('id', payload.productId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .single();
    if (!data) throw new NotFoundError('Product');
    if (data.stock < payload.quantity) throw new BadRequestError('Insufficient stock');

    unitPrice = data.price;
    if (payload.variantId) {
      const variant = (data.variants as Array<{ id: string; price_modifier?: number }>).find(
        (v) => v.id === payload.variantId
      );
      if (variant?.price_modifier) unitPrice += variant.price_modifier;
    }
  }

  if (payload.serviceId) {
    const { data } = await supabaseAdmin
      .from('services')
      .select('price')
      .eq('id', payload.serviceId)
      .eq('is_active', true)
      .single();
    if (!data) throw new NotFoundError('Service');
    unitPrice = data.price;
  }

  const { data, error } = await supabaseAdmin
    .from('cart_items')
    .insert({
      cart_id: cartId,
      product_id: payload.productId ?? null,
      service_id: payload.serviceId ?? null,
      variant_id: payload.variantId ?? null,
      quantity: payload.quantity,
      unit_price: unitPrice,
      notes: payload.notes,
    })
    .select()
    .single();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Add item failed');
  return data;
}

export async function updateItem(userId: string, itemId: string, quantity: number) {
  const cartId = await ensureCart(userId);

  const { data, error } = await supabaseAdmin
    .from('cart_items')
    .update({ quantity })
    .eq('id', itemId)
    .eq('cart_id', cartId)
    .select()
    .single();

  if (error || !data) throw new NotFoundError('Cart item');
  return data;
}

export async function removeItem(userId: string, itemId: string) {
  const cartId = await ensureCart(userId);
  const { error } = await supabaseAdmin
    .from('cart_items')
    .delete()
    .eq('id', itemId)
    .eq('cart_id', cartId);
  if (error) throw new NotFoundError('Cart item');
}

export async function clearCart(userId: string) {
  const cartId = await ensureCart(userId);
  await supabaseAdmin.from('cart_items').delete().eq('cart_id', cartId);
}
