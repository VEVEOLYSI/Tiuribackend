import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

export async function listDiscountCodes(query: { page?: string; limit?: string; active?: string }) {
  const { page, limit, offset } = parsePage(query);

  let q = supabaseAdmin
    .from('discount_codes')
    .select('id, code, description, type, value, min_order_amount, max_uses, used_count, is_active, starts_at, expires_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.active === 'true') q = q.eq('is_active', true);
  if (query.active === 'false') q = q.eq('is_active', false);

  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function createDiscountCode(
  actorId: string,
  payload: {
    code: string; description?: string; type: 'percent' | 'fixed';
    value: number; minOrderAmount?: number; maxDiscountCap?: number;
    maxUses?: number; maxUsesPerUser?: number;
    startsAt?: string; expiresAt?: string;
  }
) {
  const code = payload.code.toUpperCase().trim();

  const { data: existing } = await supabaseAdmin
    .from('discount_codes')
    .select('id')
    .eq('code', code)
    .maybeSingle();

  if (existing) throw new BadRequestError(`Code "${code}" already exists`);

  const { data, error } = await supabaseAdmin
    .from('discount_codes')
    .insert({
      code,
      description: payload.description,
      type: payload.type,
      value: payload.value,
      min_order_amount: payload.minOrderAmount,
      max_discount_cap: payload.maxDiscountCap,
      max_uses: payload.maxUses ?? null,
      max_uses_per_user: payload.maxUsesPerUser ?? 1,
      starts_at: payload.startsAt,
      expires_at: payload.expiresAt,
      created_by: actorId,
    })
    .select()
    .single();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');
  return data;
}

export async function updateDiscountCode(id: string, payload: Partial<{
  description: string; isActive: boolean; maxUses: number;
  expiresAt: string; startsAt: string;
}>) {
  const updates: Record<string, unknown> = {};
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.isActive !== undefined) updates.is_active = payload.isActive;
  if (payload.maxUses !== undefined) updates.max_uses = payload.maxUses;
  if (payload.expiresAt !== undefined) updates.expires_at = payload.expiresAt;
  if (payload.startsAt !== undefined) updates.starts_at = payload.startsAt;

  const { data, error } = await supabaseAdmin
    .from('discount_codes')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) throw new NotFoundError('Discount code');
  return data;
}

export async function validateCode(code: string, userId: string, orderAmount: number) {
  const { data: dc } = await supabaseAdmin
    .from('discount_codes')
    .select('id, type, value, min_order_amount, max_discount_cap, max_uses, used_count, max_uses_per_user, starts_at, expires_at')
    .eq('code', code.toUpperCase())
    .eq('is_active', true)
    .maybeSingle();

  if (!dc) return { valid: false, reason: 'Code not found or inactive' };

  const now = new Date();
  if (dc.starts_at && new Date(dc.starts_at) > now) return { valid: false, reason: 'Code not yet active' };
  if (dc.expires_at && new Date(dc.expires_at) < now) return { valid: false, reason: 'Code expired' };
  if (dc.max_uses && dc.used_count >= dc.max_uses) return { valid: false, reason: 'Code exhausted' };
  if (dc.min_order_amount && orderAmount < dc.min_order_amount) {
    return { valid: false, reason: `Minimum order is KES ${dc.min_order_amount}` };
  }

  const { count } = await supabaseAdmin
    .from('discount_code_uses')
    .select('id', { count: 'exact', head: true })
    .eq('discount_code_id', dc.id)
    .eq('user_id', userId);

  if ((count ?? 0) >= dc.max_uses_per_user) return { valid: false, reason: 'Already used' };

  const discountAmount =
    dc.type === 'percent'
      ? Math.min(orderAmount * (dc.value / 100), dc.max_discount_cap ?? Infinity)
      : dc.value;

  return { valid: true, discountAmount, type: dc.type, value: dc.value };
}
