import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';
import type { AssetStatus } from '../types/index.js';

export async function listAssets(query: {
  status?: string;
  branchId?: string;
  category?: string;
  page?: string;
  limit?: string;
}) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('assets')
    .select('*, branches(name), profiles!assigned_to(name), suppliers(name)', { count: 'exact' })
    .order('name')
    .range(offset, offset + limit - 1);
  if (query.status) q = q.eq('status', query.status);
  if (query.branchId) q = q.eq('branch_id', query.branchId);
  if (query.category) q = q.ilike('category', `%${query.category}%`);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getAsset(id: string) {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .select('*, branches(name), profiles!assigned_to(name), suppliers(name)')
    .eq('id', id)
    .single();
  if (error || !data) throw new NotFoundError('Asset');
  return data;
}

export async function createAsset(payload: {
  name: string;
  assetNumber?: string;
  category?: string;
  branchId?: string;
  assignedTo?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  supplierId?: string;
  usefulLifeYears?: number;
  salvageValue?: number;
  location?: string;
  serialNumber?: string;
  notes?: string;
  nextServiceDate?: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .insert({
      name:               payload.name,
      asset_number:       payload.assetNumber ?? null,
      category:           payload.category ?? null,
      branch_id:          payload.branchId ?? null,
      assigned_to:        payload.assignedTo ?? null,
      purchase_date:      payload.purchaseDate ?? null,
      purchase_cost:      payload.purchaseCost ?? null,
      supplier_id:        payload.supplierId ?? null,
      useful_life_years:  payload.usefulLifeYears ?? null,
      salvage_value:      payload.salvageValue ?? 0,
      location:           payload.location ?? null,
      serial_number:      payload.serialNumber ?? null,
      notes:              payload.notes ?? null,
      next_service_date:  payload.nextServiceDate ?? null,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Asset creation failed');
  return data;
}

export async function updateAsset(
  id: string,
  payload: Partial<{
    name: string;
    status: AssetStatus;
    branchId: string;
    assignedTo: string;
    location: string;
    notes: string;
    nextServiceDate: string;
  }>
) {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .update({
      name:              payload.name,
      status:            payload.status,
      branch_id:         payload.branchId,
      assigned_to:       payload.assignedTo,
      location:          payload.location,
      notes:             payload.notes,
      next_service_date: payload.nextServiceDate,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw new NotFoundError('Asset');
  return data;
}

export async function addMaintenance(
  actorId: string,
  assetId: string,
  payload: {
    serviceDate: string;
    description: string;
    cost?: number;
    performedBy?: string;
    nextDueDate?: string;
  }
) {
  const { data: asset } = await supabaseAdmin.from('assets').select('id').eq('id', assetId).single();
  if (!asset) throw new NotFoundError('Asset');

  const { data, error } = await supabaseAdmin
    .from('asset_maintenance')
    .insert({
      asset_id:     assetId,
      service_date: payload.serviceDate,
      description:  payload.description,
      cost:         payload.cost ?? null,
      performed_by: payload.performedBy ?? null,
      next_due_date: payload.nextDueDate ?? null,
      created_by:   actorId,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Maintenance record failed');

  // Update next_service_date on the asset
  if (payload.nextDueDate) {
    await supabaseAdmin
      .from('assets')
      .update({ next_service_date: payload.nextDueDate, status: 'active' })
      .eq('id', assetId);
  }

  return data;
}

export async function listMaintenance(assetId: string) {
  const { data } = await supabaseAdmin
    .from('asset_maintenance')
    .select('*, profiles!created_by(name)')
    .eq('asset_id', assetId)
    .order('service_date', { ascending: false });
  return data ?? [];
}

export async function getDepreciation(assetId: string) {
  const { data: asset, error } = await supabaseAdmin
    .from('assets')
    .select('purchase_cost, salvage_value, useful_life_years, purchase_date, name')
    .eq('id', assetId)
    .single();
  if (error || !asset) throw new NotFoundError('Asset');

  const cost = Number(asset.purchase_cost ?? 0);
  const salvage = Number(asset.salvage_value ?? 0);
  const lifeYears = asset.useful_life_years;

  if (!cost || !lifeYears || !asset.purchase_date) {
    return { assetId, message: 'Insufficient data for depreciation calculation', annualDepreciation: null, bookValue: null };
  }

  const annualDepreciation = (cost - salvage) / lifeYears;
  const yearsOwned = (Date.now() - new Date(asset.purchase_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const accumulatedDepreciation = Math.min(annualDepreciation * yearsOwned, cost - salvage);
  const bookValue = Math.max(cost - accumulatedDepreciation, salvage);

  return {
    assetId,
    name:                    asset.name,
    purchaseCost:            cost,
    salvageValue:            salvage,
    usefulLifeYears:         lifeYears,
    annualDepreciation:      Math.round(annualDepreciation * 100) / 100,
    yearsOwned:              Math.round(yearsOwned * 100) / 100,
    accumulatedDepreciation: Math.round(accumulatedDepreciation * 100) / 100,
    bookValue:               Math.round(bookValue * 100) / 100,
  };
}
