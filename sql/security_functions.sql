-- =============================================================================
-- SECURITY HELPER FUNCTIONS
-- Run in Supabase SQL Editor (once, after primarysql.sql)
-- =============================================================================


-- =============================================================================
-- get_profile_by_email
-- Looks up a profile by email via auth.users — used in the login service
-- to track failed login attempts without exposing all users.
-- SECURITY DEFINER runs as the function owner (postgres) so auth.users is
-- accessible even from a restricted application role.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_profile_by_email(p_email TEXT)
RETURNS TABLE (
  id                UUID,
  failed_login_count INT,
  locked_until       TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.failed_login_count, p.locked_until
  FROM   auth.users  au
  JOIN   public.profiles p ON p.id = au.id
  WHERE  au.email = p_email
  LIMIT  1;
END;
$$;


-- =============================================================================
-- is_email_confirmed
-- Returns true when the auth.users row has a confirmed email.
-- Used as a belt-and-suspenders guard in the application layer.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_email_confirmed(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email_confirmed_at IS NOT NULL
  FROM   auth.users
  WHERE  id = p_user_id;
$$;
