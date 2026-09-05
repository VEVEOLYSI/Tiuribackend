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

// Verify connectivity at startup.
// `profiles` is the table this app actually uses — the old check queried a
// `users` table that the schema never defines, so a perfectly healthy database
// still reported a failure here.
async function checkConnection(): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    if (!error) {
      logger.info('Supabase connected', { url: env.SUPABASE_URL });
      return;
    }

    // Separate "never reached the server" from "the server said no". Undici
    // surfaces DNS and connection problems as a bare `fetch failed`, which on
    // its own says nothing about what to go and look at.
    const unreachable = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i
      .test(error.message);

    if (unreachable) {
      logger.error('Cannot reach Supabase — the host never responded', {
        url: env.SUPABASE_URL,
        cause: error.message,
        check: 'Does SUPABASE_URL still resolve? A deleted or renamed project returns NXDOMAIN; a paused one resolves but refuses queries.',
      });
    } else {
      logger.error('Supabase answered but the query failed', {
        url: env.SUPABASE_URL,
        error: error.message,
        check: 'Is the schema in sql/ applied, and is SUPABASE_SERVICE_ROLE_KEY from this same project?',
      });
    }
  } catch (err) {
    logger.error('Supabase connectivity check threw', {
      url: env.SUPABASE_URL,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

void checkConnection();
