-- Run this in your Supabase SQL editor
-- Stores short-lived email OTPs for account verification

CREATE TABLE IF NOT EXISTS public.email_otps (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL,
  otp        TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_otps_email_idx ON public.email_otps (email);

-- Only the service role needs this table; RLS is not required
ALTER TABLE public.email_otps DISABLE ROW LEVEL SECURITY;
