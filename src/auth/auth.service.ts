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

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(email: string, password: string, name: string) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,          // Require email verification before first login
    user_metadata: { name },
  });

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      throw new BadRequestError('Email already in use');
    }
    throw new BadRequestError(error.message);
  }

  // Generate and send verification link
  const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${env.FRONTEND_URL}/email-verified` },
  });

  if (linkData?.properties?.action_link) {
    sendEmail({
      to: [{ email, name }],
      ...templates.verifyEmail(name, linkData.properties.action_link),
    }).catch(() => {});
  }

  return data.user;
}

// ─── Resend verification ──────────────────────────────────────────────────────

export async function resendVerification(email: string) {
  // Check if the user exists and is already confirmed — silently no-op if confirmed
  const { data: rows } = await supabaseAdmin.rpc('get_profile_by_email', { p_email: email });
  if (!rows?.length) return; // Don't reveal whether email exists

  const userId = rows[0].id as string;
  const confirmed = await supabaseAdmin.rpc('is_email_confirmed', { p_user_id: userId });
  if (confirmed.data === true) return; // Already verified — no resend needed

  const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${env.FRONTEND_URL}/email-verified` },
  });

  if (linkData?.properties?.action_link) {
    sendEmail({
      to: [{ email }],
      ...templates.verifyEmail('', linkData.properties.action_link),
    }).catch(() => {});
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = error.message.toLowerCase();

    // Surface a clear message for unverified accounts
    if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
      throw new UnauthorizedError('Please verify your email address before logging in. Check your inbox for a verification link.');
    }

    // Track failed login count using the correct per-email lookup
    await incrementFailedLogin(email);
    throw new UnauthorizedError('Invalid email or password');
  }

  // Check account lock (belt-and-suspenders — also enforced in requireAuth)
  const { data: rows } = await supabaseAdmin.rpc('get_profile_by_email', { p_email: email });
  if (rows?.length) {
    const profile = rows[0] as { id: string; failed_login_count: number; locked_until: string | null };
    if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
      throw new UnauthorizedError('Account temporarily locked due to repeated failed login attempts. Try again later.');
    }

    // Reset failed count on successful login
    await supabaseAdmin
      .from('profiles')
      .update({ failed_login_count: 0, locked_until: null, last_login_at: new Date().toISOString() })
      .eq('id', profile.id);
  }

  return data.session;
}

async function incrementFailedLogin(email: string) {
  const { data: rows } = await supabaseAdmin.rpc('get_profile_by_email', { p_email: email });
  if (!rows?.length) return;

  const profile = rows[0] as { id: string; failed_login_count: number };
  const newCount = (profile.failed_login_count ?? 0) + 1;
  const locked = newCount >= 5
    ? new Date(Date.now() + 30 * 60 * 1000).toISOString()
    : null;

  await supabaseAdmin
    .from('profiles')
    .update({ failed_login_count: newCount, locked_until: locked })
    .eq('id', profile.id);
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export async function logout(accessToken: string) {
  await supabaseAdmin.auth.admin.signOut(accessToken);
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

export async function refreshSession(refreshToken: string) {
  const client = anonClient();
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) throw new UnauthorizedError('Invalid refresh token');
  return data.session;
}

// ─── Forgot / Reset password ──────────────────────────────────────────────────

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
  // Always silent — don't reveal whether the email exists
}

export async function resetPassword(accessToken: string, newPassword: string) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !user) throw new UnauthorizedError('Invalid token');

  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });
  if (updateErr) throw new BadRequestError(updateErr.message);
}

// ─── Me ───────────────────────────────────────────────────────────────────────

export async function getMe(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, name, phone, role, avatar_url, is_active, last_login_at, created_at')
    .eq('id', userId)
    .single();

  if (error || !data) throw new UnauthorizedError('Profile not found');
  return data;
}
