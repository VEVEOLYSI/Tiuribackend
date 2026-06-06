import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';
import { logger } from './logger.js';

// Service-role client — bypasses RLS; use only for trusted server-side operations
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Anon client — respects RLS; baseline for user-scoped clients
export const supabaseAnon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Create a per-request user client that carries the user's JWT so RLS fires
export function createUserClient(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify connectivity at startup
supabaseAdmin
  .from('users')
  .select('id', { count: 'exact', head: true })
  .then(({ error }) => {
    if (error) logger.error('Supabase connection failed', { error: error.message });
    else logger.info('Supabase connected');
  });
