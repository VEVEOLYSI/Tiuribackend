import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

export async function listCategories() {
  const { data } = await supabaseAdmin.from('expense_categories').select('*').order('name');
  return data ?? [];
}

export async function listExpenses(query: {
  categoryId?: string;
  branchId?: string;
  startDate?: string;
  endDate?: string;
  approved?: string;
  page?: string;
  limit?: string;
}) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('expenses')
    .select('*, expense_categories(name), branches(name), profiles!recorded_by(name), profiles!approved_by(name)', { count: 'exact' })
    .order('expense_date', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.categoryId) q = q.eq('category_id', query.categoryId);
  if (query.branchId) q = q.eq('branch_id', query.branchId);
  if (query.startDate) q = q.gte('expense_date', query.startDate);
  if (query.endDate) q = q.lte('expense_date', query.endDate);
  if (query.approved === 'true') q = q.not('approved_at', 'is', null);
  if (query.approved === 'false') q = q.is('approved_at', null);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getExpense(id: string) {
  const { data, error } = await supabaseAdmin
    .from('expenses')
    .select('*, expense_categories(name), branches(name), profiles!recorded_by(name)')
    .eq('id', id)
    .single();
  if (error || !data) throw new NotFoundError('Expense');
  return data;
}

export async function createExpense(
  actorId: string,
  payload: {
    description: string;
    amount: number;
    expenseDate: string;
    categoryId?: string;
    branchId?: string;
    receiptUrl?: string;
    notes?: string;
  }
) {
  const { data, error } = await supabaseAdmin
    .from('expenses')
    .insert({
      description:  payload.description,
      amount:       payload.amount,
      expense_date: payload.expenseDate,
      category_id:  payload.categoryId ?? null,
      branch_id:    payload.branchId ?? null,
      receipt_url:  payload.receiptUrl ?? null,
      notes:        payload.notes ?? null,
      recorded_by:  actorId,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Expense creation failed');
  return data;
}

export async function updateExpense(
  id: string,
  payload: Partial<{
    description: string;
    amount: number;
    expenseDate: string;
    categoryId: string;
    branchId: string;
    receiptUrl: string;
    notes: string;
  }>
) {
  const { data: existing } = await supabaseAdmin.from('expenses').select('approved_at').eq('id', id).single();
  if (!existing) throw new NotFoundError('Expense');
  if (existing.approved_at) throw new BadRequestError('Cannot edit an approved expense');

  const { data, error } = await supabaseAdmin
    .from('expenses')
    .update({
      description:  payload.description,
      amount:       payload.amount,
      expense_date: payload.expenseDate,
      category_id:  payload.categoryId,
      branch_id:    payload.branchId,
      receipt_url:  payload.receiptUrl,
      notes:        payload.notes,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError('Update failed');
  return data;
}

export async function approveExpense(actorId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from('expenses')
    .update({ approved_by: actorId, approved_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw new NotFoundError('Expense');
  return data;
}

export async function deleteExpense(id: string) {
  const { data: existing } = await supabaseAdmin.from('expenses').select('approved_at').eq('id', id).single();
  if (!existing) throw new NotFoundError('Expense');
  if (existing.approved_at) throw new BadRequestError('Cannot delete an approved expense');
  const { error } = await supabaseAdmin.from('expenses').delete().eq('id', id);
  if (error) throw new BadRequestError(error.message);
}

export async function getExpenseSummary(query: { startDate?: string; endDate?: string; branchId?: string }) {
  let q = supabaseAdmin
    .from('expenses')
    .select('category_id, amount, expense_categories(name)');
  if (query.startDate) q = q.gte('expense_date', query.startDate);
  if (query.endDate) q = q.lte('expense_date', query.endDate);
  if (query.branchId) q = q.eq('branch_id', query.branchId);

  const { data } = await q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (data ?? []) as any[];
  const byCategory = new Map<string, { name: string; total: number }>();
  let grandTotal = 0;
  for (const row of items) {
    const key: string = row.category_id ?? 'uncategorized';
    const catArr: { name: string }[] | null = row.expense_categories;
    const name: string = (Array.isArray(catArr) ? catArr[0]?.name : null) ?? 'Uncategorized';
    const entry = byCategory.get(key) ?? { name, total: 0 };
    entry.total += Number(row.amount);
    byCategory.set(key, entry);
    grandTotal += Number(row.amount as number);
  }

  return { grandTotal, byCategory: Array.from(byCategory.values()) };
}
