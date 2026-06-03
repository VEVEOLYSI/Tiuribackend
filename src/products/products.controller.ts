import type { Context } from 'hono';
import { z } from 'zod';
import * as productsService from './products.service.js';
import { ok, paginated, noContent } from '../utils/response.js';
import type { AppEnv } from '../types/index.js';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(220).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  sku: z.string().max(50).optional(),
  price: z.number().nonnegative(),
  compareAtPrice: z.number().nonnegative().optional(),
  costPrice: z.number().nonnegative().optional(),
  stock: z.number().int().nonnegative().default(0),
  images: z.array(z.object({ url: z.string(), alt: z.string().optional() })).default([]),
  variants: z.array(z.record(z.string(), z.unknown())).default([]),
  categoryIds: z.array(z.string().uuid()).default([]),
  isFeatured: z.boolean().default(false),
  weightGrams: z.number().int().positive().optional(),
  metaTitle: z.string().max(200).optional(),
  metaDescription: z.string().max(500).optional(),
});

export async function list(c: Context<AppEnv>) {
  const q = c.req.query() as Record<string, string>;
  const result = await productsService.listProducts(q);
  return paginated(c, result.data, result.meta);
}

export async function getBySlug(c: Context<AppEnv>) {
  const { slug } = c.req.param();
  const product = await productsService.getProductBySlug(slug);
  return ok(c, product);
}

export async function create(c: Context<AppEnv>) {
  const body = createSchema.parse(await c.req.json());
  const product = await productsService.createProduct(body);
  return ok(c, product, 201);
}

export async function update(c: Context<AppEnv>) {
  const { id } = c.req.param();
  const body = createSchema.partial().parse(await c.req.json());
  const product = await productsService.updateProduct(id, body);
  return ok(c, product);
}

export async function remove(c: Context<AppEnv>) {
  const { id } = c.req.param();
  await productsService.deleteProduct(id);
  return noContent(c);
}
