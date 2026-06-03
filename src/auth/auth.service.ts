import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../config/db.js';
import { env } from '../config/env.js';
import { sendEmail, templates } from '../config/email.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';

function anonClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function register(email: string, password: string, name: string) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      throw new BadRequestError('Email already in use');
    }
    throw new BadRequestError(error.message);
  }

  sendEmail({ to: [{ email, name }], ...templates.welcome(name) }).catch(() => {});
  return data.user;
}

export async function login(email: string, password: string) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    // Best-effort: find user by email via listUsers to update failed login count
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    const found = list?.users.find((u) => u.email === email);
    if (found) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, failed_login_count')
        .eq('id', found.id)
        .maybeSingle();
      if (profile) {
        const newCount = (profile.failed_login_count ?? 0) + 1;
        const locked = newCount >= 5 ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;
        await supabaseAdmin
          .from('profiles')
          .update({ failed_login_count: newCount, locked_until: locked })
          .eq('id', profile.id);
      }
    }
    throw new UnauthorizedError('Invalid email or password');
  }

  // Reset failed count
  await supabaseAdmin
    .from('profiles')
    .update({ failed_login_count: 0, locked_until: null, last_login_at: new Date().toISOString() })
    .eq('id', data.user.id);

  return data.session;
}

export async function logout(accessToken: string) {
  await supabaseAdmin.auth.admin.signOut(accessToken);
}

export async function refreshSession(refreshToken: string) {
  const client = anonClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) throw new UnauthorizedError('Invalid refresh token');
  return data.session;
}

export async function forgotPassword(email: string) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${env.FRONTEND_URL}/reset-password` },
  });

  if (!error && data.properties?.action_link) {
    sendEmail({
      to: [{ email }],
      ...templates.passwordReset(data.properties.action_link),
    }).catch(() => {});
  }
  // Silent if user not found — don't reveal if email exists
}

export async function resetPassword(accessToken: string, newPassword: string) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !user) throw new UnauthorizedError('Invalid token');

  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });
  if (updateErr) throw new BadRequestError(updateErr.message);
}

export async function getMe(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, phone, role, avatar_url, is_active, last_login_at, created_at')
    .eq('id', userId)
    .single();

  if (error || !data) throw new UnauthorizedError('Profile not found');
  return data;
}
