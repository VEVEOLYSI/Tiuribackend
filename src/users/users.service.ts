import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export async function getProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, phone, role, avatar_url, last_login_at, created_at, updated_at')
    .eq('id', userId)
    .single();
  if (error || !data) throw new NotFoundError('Profile');
  return data;
}

export async function updateProfile(
  userId: string,
  updates: { name?: string; phone?: string; avatarUrl?: string }
) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({
      ...(updates.name && { name: updates.name }),
      ...(updates.phone !== undefined && { phone: updates.phone }),
      ...(updates.avatarUrl !== undefined && { avatar_url: updates.avatarUrl }),
    })
    .eq('id', userId)
    .select('id, name, phone, avatar_url, updated_at')
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Update failed');
  return data;
}

export async function listAddresses(userId: string) {
  const { data } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });
  return data ?? [];
}

export async function createAddress(
  userId: string,
  payload: {
    label?: string;
    street: string;
    city: string;
    county?: string;
    postalCode?: string;
    country?: string;
    isDefault?: boolean;
  }
) {
  if (payload.isDefault) {
    await supabaseAdmin
      .from('addresses')
      .update({ is_default: false })
      .eq('user_id', userId);
  }

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .insert({
      user_id: userId,
      label: payload.label,
      street: payload.street,
      city: payload.city,
      county: payload.county,
      postal_code: payload.postalCode,
      country: payload.country ?? 'KE',
      is_default: payload.isDefault ?? false,
    })
    .select()
    .single();

  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');
  return data;
}

export async function updateAddress(userId: string, addressId: string, payload: Partial<{
  label: string; street: string; city: string; county: string;
  postalCode: string; country: string; isDefault: boolean;
}>) {
  if (payload.isDefault) {
    await supabaseAdmin.from('addresses').update({ is_default: false }).eq('user_id', userId);
  }

  const { data, error } = await supabaseAdmin
    .from('addresses')
    .update({
      ...(payload.label !== undefined && { label: payload.label }),
      ...(payload.street && { street: payload.street }),
      ...(payload.city && { city: payload.city }),
      ...(payload.county !== undefined && { county: payload.county }),
      ...(payload.postalCode !== undefined && { postal_code: payload.postalCode }),
      ...(payload.country && { country: payload.country }),
      ...(payload.isDefault !== undefined && { is_default: payload.isDefault }),
    })
    .eq('id', addressId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) throw new NotFoundError('Address');
  return data;
}

export async function deleteAddress(userId: string, addressId: string) {
  const { error } = await supabaseAdmin
    .from('addresses')
    .delete()
    .eq('id', addressId)
    .eq('user_id', userId);
  if (error) throw new NotFoundError('Address');
}
