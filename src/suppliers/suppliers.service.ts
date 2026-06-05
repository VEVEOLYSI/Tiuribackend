import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

// ─── Suppliers ────────────────────────────────────────────────────────────────

export async function listSuppliers(query: { search?: string; page?: string; limit?: string }) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('suppliers')
    .select('*', { count: 'exact' })
    .eq('is_active', true)
    .order('name')
    .range(offset, offset + limit - 1);
  if (query.search) q = q.ilike('name', `%${query.search}%`);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getSupplier(id: string) {
  const { data, error } = await supabaseAdmin.from('suppliers').select('*').eq('id', id).single();
  if (error || !data) throw new NotFoundError('Supplier');
  return data;
}

export async function createSupplier(payload: {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('suppliers')
    .insert({
      name:         payload.name,
      contact_name: payload.contactName ?? null,
      email:        payload.email ?? null,
      phone:        payload.phone ?? null,
      address:      payload.address ?? null,
      notes:        payload.notes ?? null,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Supplier creation failed');
  return data;
}

export async function updateSupplier(
  id: string,
  payload: Partial<{ name: string; contactName: string; email: string; phone: string; address: string; notes: string; isActive: boolean }>
) {
  const { data, error } = await supabaseAdmin
    .from('suppliers')
    .update({
      name:         payload.name,
      contact_name: payload.contactName,
      email:        payload.email,
      phone:        payload.phone,
      address:      payload.address,
      notes:        payload.notes,
      is_active:    payload.isActive,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw new NotFoundError('Supplier');
  return data;
}

// ─── Purchase Orders ──────────────────────────────────────────────────────────

export async function listPOs(query: { supplierId?: string; status?: string; page?: string; limit?: string }) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('purchase_orders')
    .select('*, suppliers(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.supplierId) q = q.eq('supplier_id', query.supplierId);
  if (query.status) q = q.eq('status', query.status);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getPO(id: string) {
  const { data, error } = await supabaseAdmin
    .from('purchase_orders')
    .select('*, suppliers(name)')
    .eq('id', id)
    .single();
  if (error || !data) throw new NotFoundError('Purchase order');

  const { data: items } = await supabaseAdmin
    .from('purchase_order_items')
    .select('*, inventory_items(name, unit)')
    .eq('purchase_order_id', id);

  return { ...data, items: items ?? [] };
}

export async function createPO(
  actorId: string,
  payload: {
    supplierId: string;
    items: Array<{ itemId: string; quantity: number; unitCost: number }>;
    notes?: string;
    expectedAt?: string;
  }
) {
  if (!payload.items.length) throw new BadRequestError('At least one item required');

  const poNumber = (await supabaseAdmin.rpc('generate_po_number')).data as string;
  const totalAmount = payload.items.reduce((acc, i) => acc + i.quantity * i.unitCost, 0);

  const { data: po, error } = await supabaseAdmin
    .from('purchase_orders')
    .insert({
      supplier_id:  payload.supplierId,
      po_number:    poNumber,
      total_amount: totalAmount,
      notes:        payload.notes ?? null,
      expected_at:  payload.expectedAt ?? null,
      created_by:   actorId,
    })
    .select('*')
    .single();
  if (error || !po) throw new BadRequestError(error?.message ?? 'PO creation failed');

  const lineItems = payload.items.map((i) => ({
    purchase_order_id: po.id,
    item_id:           i.itemId,
    quantity:          i.quantity,
    unit_cost:         i.unitCost,
  }));
  const { error: itemErr } = await supabaseAdmin.from('purchase_order_items').insert(lineItems);
  if (itemErr) throw new BadRequestError(itemErr.message);

  return po;
}

export async function receivePO(
  actorId: string,
  poId: string,
  items: Array<{ itemId: string; receivedQty: number }>
) {
  const { data: po } = await supabaseAdmin
    .from('purchase_orders')
    .select('status')
    .eq('id', poId)
    .single();
  if (!po) throw new NotFoundError('Purchase order');
  if (po.status === 'received') throw new BadRequestError('Already received');
  if (po.status === 'cancelled') throw new BadRequestError('Cannot receive a cancelled PO');

  // Record stock-in transactions and update received_qty
  for (const item of items) {
    if (item.receivedQty <= 0) continue;

    await supabaseAdmin
      .from('purchase_order_items')
      .update({ received_qty: item.receivedQty })
      .eq('purchase_order_id', poId)
      .eq('item_id', item.itemId);

    await supabaseAdmin.from('inventory_transactions').insert({
      item_id:        item.itemId,
      type:           'stock_in',
      quantity:       item.receivedQty,
      reference_id:   poId,
      reference_type: 'purchase_order',
      recorded_by:    actorId,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('purchase_orders')
    .update({ status: 'received', received_at: new Date().toISOString() })
    .eq('id', poId)
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError('Receive failed');
  return data;
}

export async function updatePOStatus(poId: string, status: 'sent' | 'cancelled') {
  const { data, error } = await supabaseAdmin
    .from('purchase_orders')
    .update({ status })
    .eq('id', poId)
    .select('*')
    .single();
  if (error || !data) throw new NotFoundError('Purchase order');
  return data;
}
