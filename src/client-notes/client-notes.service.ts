import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors.js';
import { parsePage } from '../utils/pagination.js';

export async function createNote(
  staffId: string,
  payload: { clientId: string; bookingId?: string; note: string; isFlagged?: boolean }
) {
  const { data, error } = await supabaseAdmin
    .from('client_notes')
    .insert({
      client_id:  payload.clientId,
      staff_id:   staffId,
      booking_id: payload.bookingId ?? null,
      note:       payload.note,
      is_flagged: payload.isFlagged ?? false,
    })
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Note creation failed');
  return data;
}

export async function listClientNotes(
  clientId: string,
  query: { page?: string; limit?: string; flaggedOnly?: string }
) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('client_notes')
    .select('*, profiles!staff_id(name)', { count: 'exact' })
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.flaggedOnly === 'true') q = q.eq('is_flagged', true);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}

export async function updateNote(
  actorId: string,
  noteId: string,
  payload: Partial<{ note: string; isFlagged: boolean }>,
  isAdmin: boolean
) {
  const { data: existing } = await supabaseAdmin
    .from('client_notes')
    .select('staff_id')
    .eq('id', noteId)
    .single();
  if (!existing) throw new NotFoundError('Note');
  if (!isAdmin && existing.staff_id !== actorId) throw new ForbiddenError('Cannot edit another staff member\'s note');

  const { data, error } = await supabaseAdmin
    .from('client_notes')
    .update({ note: payload.note, is_flagged: payload.isFlagged })
    .eq('id', noteId)
    .select('*')
    .single();
  if (error || !data) throw new BadRequestError('Update failed');
  return data;
}

export async function deleteNote(actorId: string, noteId: string, isAdmin: boolean) {
  const { data: existing } = await supabaseAdmin
    .from('client_notes')
    .select('staff_id')
    .eq('id', noteId)
    .single();
  if (!existing) throw new NotFoundError('Note');
  if (!isAdmin && existing.staff_id !== actorId) throw new ForbiddenError('Cannot delete another staff member\'s note');

  const { error } = await supabaseAdmin.from('client_notes').delete().eq('id', noteId);
  if (error) throw new BadRequestError(error.message);
}

export async function getAllNotes(query: { page?: string; limit?: string; clientId?: string; flaggedOnly?: string }) {
  const { page, limit, offset } = parsePage(query);
  let q = supabaseAdmin
    .from('client_notes')
    .select('*, profiles!client_id(name), profiles!staff_id(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.clientId) q = q.eq('client_id', query.clientId);
  if (query.flaggedOnly === 'true') q = q.eq('is_flagged', true);
  const { data, count } = await q;
  return { data: data ?? [], meta: { total: count ?? 0, page, limit } };
}
