-- =============================================================================
-- BOOKING LIFECYCLE MIGRATION
-- 1. Adds actual_start_time and actual_end_time to service_bookings so that
--    early finishes free up slots and overruns are tracked accurately.
-- 2. Sets deposit_percent = 30 on all services that have no deposit configured.
-- Run in Supabase SQL Editor.
-- =============================================================================

-- Lifecycle columns
ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS actual_start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_end_time   TIMESTAMPTZ;

-- Index for slot-generation query
CREATE INDEX IF NOT EXISTS idx_service_bookings_actual_end
  ON public.service_bookings(staff_id, scheduled_date, actual_end_time)
  WHERE actual_end_time IS NOT NULL;

-- Set 30% deposit on all services that have no deposit configured yet
UPDATE public.services
SET deposit_percent = 30
WHERE deposit_percent = 0;
