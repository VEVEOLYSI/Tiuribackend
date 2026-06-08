import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../config/db.js';
import { env } from '../config/env.js';
import { sendEmail, templates } from '../config/email.js';
import { logger } from '../config/logger.js';
import { BadRequestError, UnauthorizedError } from '../utils/errors.js';

function anonClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ─── OTP helpers ──────────────────────────────────────────────────────────────

function makeOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Stores user_id + name so verifyOtp and resendVerification don't depend on profiles
async function issueOtp(email: string, userId: string, name: string): Promise<string> {
  const otp = makeOtp();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  await supabaseAdmin.from('email_otps').delete().eq('email', email);
  const { error } = await supabaseAdmin.from('email_otps').insert({
    email, otp, expires_at: expiresAt, user_id: userId, user_name: name,
  });
  if (error) throw new Error(`OTP storage failed: ${error.message}`);

  return otp;
}

// ─── Register ─────────────────────────────────────────────────────────────────

export async function register(email: string, password: string, name: string) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { name },
  });

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      throw new BadRequestError('Email already in use');
    }
    throw new BadRequestError(error.message);
  }

  const otp = await issueOtp(email, data.user.id, name);

  // Await email — if delivery fails, roll back the auth user so the address can be retried
  try {
    await sendEmail({ to: [{ email, name }], ...templates.otpVerification(name, otp) });
  } catch {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {});
    try { await supabaseAdmin.from('email_otps').delete().eq('email', email); } catch { /* ignore */ }
    throw new BadRequestError('Invalid or unreachable email. Please try again.');
  }

  return data.user;
}

// ─── Resend verification ──────────────────────────────────────────────────────

export async function resendVerification(email: string) {
  let userId: string;
  let name: string;

  // Fast path: OTP row has user_id (normal case after migration)
  const { data: otpRow } = await supabaseAdmin
    .from('email_otps')
    .select('user_id, user_name')
    .eq('email', email)
    .maybeSingle();

  if (otpRow?.user_id) {
    userId = otpRow.user_id as string;
    name   = (otpRow.user_name as string) ?? '';
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (!user) return;
    if (user.email_confirmed_at) {
      // Email already confirmed but profile might be missing (interrupted verification).
      // Ensure profile exists so the user can sign in normally.
      await supabaseAdmin.from('profiles').upsert(
        { id: userId, name, role: 'customer', is_active: true, failed_login_count: 0 },
        { onConflict: 'id' },
      );
      return;
    }
  } else {
    // Fallback: OTP row missing or has no user_id (e.g. registered before schema migration).
    // Scan auth users to find the account by email.
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 10000 });
    const authUser = users.find((u) => u.email === email);
    if (!authUser) return;
    if (authUser.email_confirmed_at) {
      // Same recovery: ensure profile exists.
      const recoveryName = (authUser.user_metadata?.name as string) ?? '';
      await supabaseAdmin.from('profiles').upsert(
        { id: authUser.id, name: recoveryName, role: 'customer', is_active: true, failed_login_count: 0 },
        { onConflict: 'id' },
      );
      return;
    }
    userId = authUser.id;
    name   = (authUser.user_metadata?.name as string) ?? '';
  }

  const otp = await issueOtp(email, userId, name);
  sendEmail({ to: [{ email, name }], ...templates.otpVerification(name, otp) }).catch(() => {});
}

// ─── Verify OTP ───────────────────────────────────────────────────────────────

export async function verifyOtp(email: string, otp: string) {
  const { data: row, error } = await supabaseAdmin
    .from('email_otps')
    .select('otp, expires_at, user_id, user_name')
    .eq('email', email)
    .eq('otp', otp)
    .maybeSingle();

  if (error || !row) throw new BadRequestError('Invalid verification code');

  if (new Date(row.expires_at as string) < new Date()) {
    await supabaseAdmin.from('email_otps').delete().eq('email', email);
    throw new BadRequestError('Verification code has expired. Please request a new one.');
  }

  const userId = row.user_id as string;
  const name  = (row.user_name as string) ?? '';

  // 1. Mark email confirmed
  await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });

  // 2. Consume OTP
  await supabaseAdmin.from('email_otps').delete().eq('email', email);

  // 3. Create profile immediately — before attempting session so it always exists
  await supabaseAdmin.from('profiles').upsert(
    { id: userId, name, role: 'customer', is_active: true, failed_login_count: 0 },
    { onConflict: 'id' },
  );

  // 4. Welcome email (fire-and-forget)
  sendEmail({ to: [{ email, name }], ...templates.welcome(name) }).catch(() => {});

  // 5. Auto-login via magic-link token exchange. If this fails the profile already
  //    exists so the user can sign in manually — return session: null instead of throwing.
  try {
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      logger.warn('verifyOtp: generateLink failed', { email, error: linkErr?.message });
      return { session: null };
    }

    const { data: sessionData, error: sessionErr } = await anonClient().auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    });
    if (sessionErr || !sessionData?.session) {
      logger.warn('verifyOtp: session exchange failed', { email, error: sessionErr?.message });
      return { session: null };
    }

    return { session: sessionData.session };
  } catch (err) {
    logger.warn('verifyOtp: auto-login failed', { email, error: (err as Error).message });
    return { session: null };
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = error.message.toLowerCase();

    if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
      throw new UnauthorizedError('EMAIL_NOT_VERIFIED');
    }

    await incrementFailedLogin(email);
    throw new UnauthorizedError('Invalid email or password');
  }

  const { data: rows } = await supabaseAdmin.rpc('get_profile_by_email', { p_email: email });
  if (rows?.length) {
    const profile = rows[0] as { id: string; failed_login_count: number; locked_until: string | null };
    if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
      throw new UnauthorizedError('Account temporarily locked due to repeated failed login attempts. Try again later.');
    }

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
  // Look up user — silently no-op if email not registered (prevents enumeration)
  const { data: rows, error: rpcErr } = await supabaseAdmin.rpc('get_profile_by_email', { p_email: email });

  if (rpcErr) {
    logger.error('forgotPassword: profile lookup failed', { email, error: rpcErr.message });
    return;
  }

  if (!rows?.length) {
    logger.info('forgotPassword: email not found in system (no-op)', { email });
    return;
  }

  const name   = (rows[0].name as string | undefined) ?? '';
  const userId = rows[0].id as string;
  const token  = await issueOtp(email, userId, name);
  const resetLink =
    `${env.FRONTEND_URL}/auth/reset-password?email=${encodeURIComponent(email)}&token=${token}`;

  logger.info('forgotPassword: sending reset email', { email });

  try {
    await sendEmail({
      to: [{ email, name }],
      ...templates.passwordReset(resetLink),
    });
  } catch (err: unknown) {
    logger.error('forgotPassword: email send failed', {
      email,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function resetPassword(email: string, token: string, newPassword: string) {
  // Verify the OTP token
  const { data: row } = await supabaseAdmin
    .from('email_otps')
    .select('otp, expires_at')
    .eq('email', email)
    .eq('otp', token)
    .maybeSingle();

  if (!row) throw new UnauthorizedError('Invalid or expired reset link');

  if (new Date(row.expires_at as string) < new Date()) {
    await supabaseAdmin.from('email_otps').delete().eq('email', email);
    throw new UnauthorizedError('Reset link has expired — please request a new one');
  }

  // Look up the user
  const { data: rows } = await supabaseAdmin.rpc('get_profile_by_email', { p_email: email });
  if (!rows?.length) throw new BadRequestError('Account not found');

  const userId = rows[0].id as string;
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (updateErr) throw new BadRequestError(updateErr.message);

  // Consume the token so it can't be reused
  await supabaseAdmin.from('email_otps').delete().eq('email', email);
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
