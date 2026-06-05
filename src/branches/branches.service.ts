import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

export async function listBranches(includeInactive = false) {
  let q = supabaseAdmin.from('branches').select('*').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new BadRequestError(error.message);
  return data ?? [];
}

export async function getBranch(id: string) {
  const { data, error } = await supabaseAdmin.from('branches').select('*').eq('id', id).single();
  if (error || !data) throw new NotFoundError('Branch');
  return data;
}

export async function createBranch(payload: { name: string; address?: string; phone?: string }) {
  const { data, error } = await supabaseAdmin
    .from('branches')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Branch creation failed');
  return data;
}

export async function updateBranch(
  id: string,
  payload: Partial<{ name: string; address: string; phone: string; is_active: boolean }>
) {
  const { data, error } = await supabaseAdmin
    .from('branches')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw new NotFoundError('Branch');
  return data;
}

export async function deleteBranch(id: string) {
  const { count } = await supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', id);
  if ((count ?? 0) > 0) throw new BadRequestError('Branch has assigned staff. Reassign them first.');

  const { error } = await supabaseAdmin.from('branches').delete().eq('id', id);
  if (error) throw new BadRequestError(error.message);
}

export async function listBranchStaff(branchId: string, query: { page?: string; limit?: string }) {
  const { page, limit, offset } = parsePage(query);
  const { data, count } = await supabaseAdmin
    .from('profiles')
    .select('id, name, phone, role, is_active, last_login_at', { count: 'exact' })
    .eq('branch_id', branchId)
    .eq('role', 'staff')
    .is('deleted_at', null)
    .order('name')
    .range(offset, offset + limit - 1);
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
