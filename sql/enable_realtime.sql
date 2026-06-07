-- =============================================================================
-- ENABLE SUPABASE REALTIME
-- Run once in Supabase SQL Editor.
-- Adds every table that the frontend subscribes to into the realtime publication.
-- =============================================================================

-- Core tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_leaves;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shifts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.commission_earnings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- =============================================================================
-- DONE — tables are now published.
-- The frontend subscribes via @supabase/supabase-js Realtime channels
-- using the ANON key, so RLS still applies.
-- =============================================================================
