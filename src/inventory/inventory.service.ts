import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import type { InventoryTxnType } from '../types/index.js';

// ─── Categories ───────────────────────────────────────────────────────────────

export async function listCategories() {
  const { data } = await supabaseAdmin.from('inventory_categories').select('*').order('name');
  return data ?? [];
}

export async function createCategory(name: string) {
  const { data, error } = await supabaseAdmin
    .from('inventory_categories')
    .insert({ name })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Category creation failed');
  return data;
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function listItems(query: {
  categoryId?: string;
  supplierId?: string;
  lowStockOnly?: string;
  search?: string;
  page?: string;
  limit?: string;
}) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('inventory_items')
    .select('*, inventory_categories(name), suppliers(name)', { count: 'exact' })
    .eq('is_active', true)
    .order('name')
    .range(offset, offset + limit - 1);

  if (query.categoryId) q = q.eq('category_id', query.categoryId);
  if (query.supplierId) q = q.eq('supplier_id', query.supplierId);
  if (query.search) q = q.ilike('name', `%${query.search}%`);

  const { data, count } = await q;
  const items = data ?? [];

  if (query.lowStockOnly === 'true') {
    return {
      data: items.filter((i: { stock_quantity: number; low_stock_threshold: number }) => i.stock_quantity <= i.low_stock_threshold),
      meta: { total: count ?? 0, page, limit },
    };
  }

  return { data: items, meta: { total: count ?? 0, page, limit } };
}

export async function getItem(id: string) {
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .select('*, inventory_categories(name), suppliers(name)')
    .eq('id', id)
    .single();
  if (error || !data) throw new NotFoundError('Inventory item');
  return data;
}

export async function createItem(payload: {
  name: string;
  categoryId?: string;
  supplierId?: string;
  sku?: string;
  unit?: string;
  unitCost?: number;
  stockQuantity?: number;
  lowStockThreshold?: number;
}) {
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .insert({
      name:                payload.name,
      category_id:         payload.categoryId ?? null,
      supplier_id:         payload.supplierId ?? null,
      sku:                 payload.sku ?? null,
      unit:                payload.unit ?? 'piece',
      unit_cost:           payload.unitCost ?? null,
      stock_quantity:      payload.stockQuantity ?? 0,
      low_stock_threshold: payload.lowStockThreshold ?? 5,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Item creation failed');
  return data;
}

export async function updateItem(
  id: string,
  payload: Partial<{
    name: string;
    categoryId: string;
    supplierId: string;
    sku: string;
    unit: string;
    unitCost: number;
    lowStockThreshold: number;
    isActive: boolean;
  }>
) {
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .update({
      name:                payload.name,
      category_id:         payload.categoryId,
      supplier_id:         payload.supplierId,
      sku:                 payload.sku,
      unit:                payload.unit,
      unit_cost:           payload.unitCost,
      low_stock_threshold: payload.lowStockThreshold,
      is_active:           payload.isActive,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw new NotFoundError('Inventory item');
  return data;
}

export async function getLowStockAlerts() {
  const { data } = await supabaseAdmin
    .from('inventory_items')
    .select('*, inventory_categories(name), suppliers(name)')
    .eq('is_active', true);

  const items = (data ?? []) as Array<{ stock_quantity: number; low_stock_threshold: number }>;
  const lowStock  = items.filter((i) => i.stock_quantity > 0 && i.stock_quantity <= i.low_stock_threshold);
  const outOfStock = items.filter((i) => i.stock_quantity <= 0);
  return { lowStock, outOfStock };
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function recordTransaction(
  actorId: string,
  payload: {
    itemId: string;
    type: InventoryTxnType;
    quantity: number;
    unitCost?: number;
    notes?: string;
    referenceId?: string;
    referenceType?: string;
  }
) {
  if (payload.quantity <= 0) throw new BadRequestError('Quantity must be positive');

  // For stock-out types, verify sufficient stock
  if (['stock_out', 'wastage'].includes(payload.type)) {
    const { data: item } = await supabaseAdmin
      .from('inventory_items')
      .select('stock_quantity, name')
      .eq('id', payload.itemId)
      .single();
    if (!item) throw new NotFoundError('Inventory item');
    if (Number(item.stock_quantity) < payload.quantity) {
      throw new BadRequestError(`Insufficient stock for ${item.name}. Available: ${item.stock_quantity}`);
    }
  }

  const { data, error } = await supabaseAdmin
    .from('inventory_transactions')
    .insert({
      item_id:        payload.itemId,
      type:           payload.type,
      quantity:       payload.quantity,
      unit_cost:      payload.unitCost ?? null,
      notes:          payload.notes ?? null,
      reference_id:   payload.referenceId ?? null,
      reference_type: payload.referenceType ?? null,
      recorded_by:    actorId,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Transaction recording failed');
  return data;
}

export async function listTransactions(query: {
  itemId?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  page?: string;
  limit?: string;
}) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('inventory_transactions')
    .select('*, inventory_items(name, unit), profiles!recorded_by(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.itemId) q = q.eq('item_id', query.itemId);
  if (query.type) q = q.eq('type', query.type);
  if (query.startDate) q = q.gte('created_at', query.startDate);
  if (query.endDate) q = q.lte('created_at', query.endDate);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

// ─── Service inventory usage ──────────────────────────────────────────────────

export async function listServiceUsage(serviceId?: string) {
  let q = supabaseAdmin
    .from('service_inventory_usage')
    .select('*, services(name), inventory_items(name, unit)');
  if (serviceId) q = q.eq('service_id', serviceId);
  const { data } = await q;
  return data ?? [];
}

export async function upsertServiceUsage(serviceId: string, itemId: string, quantity: number) {
  if (quantity <= 0) throw new BadRequestError('Quantity must be positive');
  const { data, error } = await supabaseAdmin
    .from('service_inventory_usage')
    .upsert({ service_id: serviceId, item_id: itemId, quantity }, { onConflict: 'service_id,item_id' })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Failed to set service usage');
  return data;
}

export async function removeServiceUsage(serviceId: string, itemId: string) {
  const { error } = await supabaseAdmin
    .from('service_inventory_usage')
    .delete()
    .eq('service_id', serviceId)
    .eq('item_id', itemId);
  if (error) throw new BadRequestError(error.message);
}
