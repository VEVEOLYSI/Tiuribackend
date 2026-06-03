import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export async function listCategories() {
  const { data } = await supabaseAdmin
    .from('categories')
    .select('id, name, slug, description, image_url, parent_id, sort_order')
    .eq('is_active', true)
    .order('sort_order');
  return data ?? [];
}

export async function getCategoryWithProducts(slug: string) {
  const { data: cat, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();
  if (error || !cat) throw new NotFoundError('Category');

  const { data: pc } = await supabaseAdmin
    .from('product_categories')
    .select('products(id, name, slug, price, compare_at_price, images, stock)')
    .eq('category_id', cat.id);

  return { ...cat, products: (pc ?? []).map((r: { products: unknown }) => r.products) };
}

export async function createCategory(payload: {
  name: string; slug: string; description?: string;
  imageUrl?: string; parentId?: string; sortOrder?: number;
}) {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .insert({
      name: payload.name,
      slug: payload.slug,
      description: payload.description,
      image_url: payload.imageUrl,
      parent_id: payload.parentId,
      sort_order: payload.sortOrder ?? 0,
    })
    .select()
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');
  return data;
}

export async function updateCategory(id: string, payload: Partial<{
  name: string; slug: string; description: string;
  imageUrl: string; parentId: string; sortOrder: number; isActive: boolean;
}>) {
  const updates: Record<string, unknown> = {};
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.slug !== undefined) updates.slug = payload.slug;
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.imageUrl !== undefined) updates.image_url = payload.imageUrl;
  if (payload.parentId !== undefined) updates.parent_id = payload.parentId;
  if (payload.sortOrder !== undefined) updates.sort_order = payload.sortOrder;
  if (payload.isActive !== undefined) updates.is_active = payload.isActive;

  const { data, error } = await supabaseAdmin
    .from('categories')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error || !data) throw new NotFoundError('Category');
  return data;
}

export async function deleteCategory(id: string) {
  const { error } = await supabaseAdmin
    .from('categories')
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw new NotFoundError('Category');
}
