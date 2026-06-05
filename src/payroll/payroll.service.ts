import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

export async function listRuns(query: { status?: string; page?: string; limit?: string }) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('payroll_runs')
    .select('*, profiles!created_by(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.status) q = q.eq('status', query.status);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function getRun(id: string) {
  const { data: run, error } = await supabaseAdmin
    .from('payroll_runs')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !run) throw new NotFoundError('Payroll run');

  const { data: items } = await supabaseAdmin
    .from('payroll_items')
    .select('*, profiles!staff_id(name)')
    .eq('payroll_run_id', id)
    .order('created_at');

  return { ...run, items: items ?? [] };
}

export async function createRun(actorId: string, payload: { periodStart: string; periodEnd: string; notes?: string }) {
  if (new Date(payload.periodStart) > new Date(payload.periodEnd)) {
    throw new BadRequestError('Period start must be before period end');
  }

  const { data, error } = await supabaseAdmin
    .from('payroll_runs')
    .insert({
      period_start: payload.periodStart,
      period_end:   payload.periodEnd,
      notes:        payload.notes ?? null,
      created_by:   actorId,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Run creation failed');
  return data;
}

export async function calculateRunItems(runId: string) {
  const { data: run } = await supabaseAdmin
    .from('payroll_runs')
    .select('status, period_start, period_end')
    .eq('id', runId)
    .single();
  if (!run) throw new NotFoundError('Payroll run');
  if (run.status !== 'draft') throw new BadRequestError('Can only calculate items on a draft run');

  // Get all active staff
  const { data: staffList } = await supabaseAdmin
    .from('profiles')
    .select('id, staff_profiles(salary_type, base_salary, commission_pct)')
    .eq('role', 'staff')
    .eq('is_active', true)
    .is('deleted_at', null);

  if (!staffList?.length) throw new BadRequestError('No active staff found');

  // Delete existing items for this run so calculate is idempotent
  await supabaseAdmin.from('payroll_items').delete().eq('payroll_run_id', runId);

  let runTotal = 0;

  for (const staff of staffList as Array<{ id: string; staff_profiles: Array<{ salary_type: string; base_salary: number | null; commission_pct: number }> | null }>) {
    const sp = staff.staff_profiles?.[0];
    const baseSalary = Number(sp?.base_salary ?? 0);

    // Sum pending commissions in this period
    const { data: earnings } = await supabaseAdmin
      .from('commission_earnings')
      .select('commission_amount')
      .eq('staff_id', staff.id)
      .eq('status', 'pending')
      .gte('created_at', run.period_start)
      .lte('created_at', run.period_end + 'T23:59:59');

    const commissionTotal = (earnings ?? []).reduce((acc, e) => acc + Number(e.commission_amount), 0);
    const netPay = baseSalary + commissionTotal;
    runTotal += netPay;

    await supabaseAdmin.from('payroll_items').insert({
      payroll_run_id:  runId,
      staff_id:        staff.id,
      base_salary:     baseSalary,
      commission_total: commissionTotal,
      deductions:      0,
      net_pay:         netPay,
    });
  }

  // Update run total
  const { data: updated } = await supabaseAdmin
    .from('payroll_runs')
    .update({ total_amount: runTotal })
    .eq('id', runId)
    .select('*')
    .single();

  return updated;
}

export async function approveRun(actorId: string, runId: string) {
  const { data: run } = await supabaseAdmin
    .from('payroll_runs')
    .select('status')
    .eq('id', runId)
    .single();
  if (!run) throw new NotFoundError('Payroll run');
  if (run.status !== 'draft') throw new BadRequestError('Only draft runs can be approved');

  const { data, error } = await supabaseAdmin
    .from('payroll_runs')
    .update({ status: 'approved', approved_by: actorId, approved_at: new Date().toISOString() })
    .eq('id', runId)
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError('Approval failed');
  return data;
}

export async function markRunPaid(actorId: string, runId: string) {
  const { data: run } = await supabaseAdmin
    .from('payroll_runs')
    .select('status')
    .eq('id', runId)
    .single();
  if (!run) throw new NotFoundError('Payroll run');
  if (run.status !== 'approved') throw new BadRequestError('Only approved runs can be marked as paid');

  const now = new Date().toISOString();

  // Mark all commission_earnings in this run as paid
  const { data: items } = await supabaseAdmin
    .from('payroll_items')
    .select('staff_id')
    .eq('payroll_run_id', runId);

  if (items?.length) {
    for (const item of items) {
      await supabaseAdmin
        .from('commission_earnings')
        .update({ status: 'paid', payroll_run_id: runId })
        .eq('staff_id', item.staff_id)
        .eq('status', 'pending');
    }
  }

  const { data, error } = await supabaseAdmin
    .from('payroll_runs')
    .update({ status: 'paid', paid_at: now })
    .eq('id', runId)
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError('Mark paid failed');
  return data;
}

export async function getOwnPayslips(staffId: string, query: { page?: string; limit?: string }) {
  const { page, limit, offset } = parsePage(query);
  const { data, count } = await supabaseAdmin
    .from('payroll_items')
    .select('*, payroll_runs(period_start, period_end, status, paid_at)', { count: 'exact' })
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
