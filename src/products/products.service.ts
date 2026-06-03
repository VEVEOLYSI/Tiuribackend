import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

export interface ProductFilters {
  page?: string | number;
  limit?: string | number;
  search?: string;
  categorySlug?: string;
  minPrice?: string | number;
  maxPrice?: string | number;
  sort?: 'price' | 'created_at' | 'name';
  order?: 'asc' | 'desc';
  featured?: string;
}

export async function listProducts(filters: ProductFilters) {
  const { page, limit, offset } = parsePage(filters);

  let query = supabaseAdmin
    .from('products')
    .select('id, name, slug, price, compare_at_price, stock, images, variants, is_featured, created_at', {
      count: 'exact',
    })
    .is('deleted_at', null)
    .eq('is_active', true);

  if (filters.search) {
    query = query.textSearch('name', filters.search, { type: 'websearch' });
  }
  if (filters.minPrice) query = query.gte('price', Number(filters.minPrice));
  if (filters.maxPrice) query = query.lte('price', Number(filters.maxPrice));
  if (filters.featured === 'true') query = query.eq('is_featured', true);

  if (filters.categorySlug) {
    const { data: cat } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('slug', filters.categorySlug)
      .single();
    if (cat) {
      const { data: pids } = await supabaseAdmin
        .from('product_categories')
        .select('product_id')
        .eq('category_id', cat.id);
      const ids = (pids ?? []).map((r: { product_id: string }) => r.product_id);
      if (ids.length === 0) return { data: [], meta: { total: 0, page, limit } };
      query = query.in('id', ids);
    }
  }

  const sortCol = filters.sort ?? 'created_at';
  const sortAsc = filters.order === 'asc';
  query = query.order(sortCol, { ascending: sortAsc }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw new BadRequestError(error.message);

  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getProductBySlug(slug: string) {
  const { data, error } = await supabaseAdmin
    .from('product_summary')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error || !data) throw new NotFoundError('Product');

  const { data: categories } = await supabaseAdmin
    .from('product_categories')
    .select('category_id, categories(id, name, slug)')
    .eq('product_id', data.id);

  return { ...data, categories: (categories ?? []).map((r: { categories: unknown }) => r.categories) };
}

export async function createProduct(payload: {
  name: string; slug: string; description?: string; sku?: string;
  price: number; compareAtPrice?: number; costPrice?: number;
  stock: number; images?: unknown[]; variants?: unknown[];
  categoryIds?: string[]; isFeatured?: boolean; weightGrams?: number;
  metaTitle?: string; metaDescription?: string;
}) {
  const { categoryIds, ...product } = payload;

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      name: product.name,
      slug: product.slug,
      description: product.description,
      sku: product.sku,
      price: product.price,
      compare_at_price: product.compareAtPrice,
      cost_price: product.costPrice,
      stock: product.stock,
      images: product.images ?? [],
      variants: product.variants ?? [],
      is_featured: product.isFeatured ?? false,
      weight_grams: product.weightGrams,
      meta_title: product.metaTitle,
      meta_description: product.metaDescription,
    })
    .select()
    .single();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');

  if (categoryIds?.length) {
    await supabaseAdmin
      .from('product_categories')
      .insert(categoryIds.map((cid) => ({ product_id: data.id, category_id: cid })));
  }

  return data;
}

export async function updateProduct(id: string, payload: Partial<{
  name: string; slug: string; description: string; price: number;
  compareAtPrice: number; stock: number; images: unknown[]; variants: unknown[];
  isActive: boolean; isFeatured: boolean; categoryIds: string[];
}>) {
  const { categoryIds, ...rest } = payload;

  const updates: Record<string, unknown> = {};
  if (rest.name !== undefined) updates.name = rest.name;
  if (rest.slug !== undefined) updates.slug = rest.slug;
  if (rest.description !== undefined) updates.description = rest.description;
  if (rest.price !== undefined) updates.price = rest.price;
  if (rest.compareAtPrice !== undefined) updates.compare_at_price = rest.compareAtPrice;
  if (rest.stock !== undefined) updates.stock = rest.stock;
  if (rest.images !== undefined) updates.images = rest.images;
  if (rest.variants !== undefined) updates.variants = rest.variants;
  if (rest.isActive !== undefined) updates.is_active = rest.isActive;
  if (rest.isFeatured !== undefined) updates.is_featured = rest.isFeatured;

  const { data, error } = await supabaseAdmin
    .from('products')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error || !data) throw new NotFoundError('Product');

  if (categoryIds !== undefined) {
    await supabaseAdmin.from('product_categories').delete().eq('product_id', id);
    if (categoryIds.length) {
      await supabaseAdmin
        .from('product_categories')
        .insert(categoryIds.map((cid) => ({ product_id: id, category_id: cid })));
    }
  }

  return data;
}

export async function deleteProduct(id: string) {
  const { error } = await supabaseAdmin
    .from('products')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw new NotFoundError('Product');
}
