-- =============================================================================
-- SCHEDULING MIGRATION
-- Run AFTER erp_migration.sql has been applied.
-- Adds staff_schedules (recurring weekly hours) and business_settings tables
-- to power dynamic available-slot generation.
-- =============================================================================


-- =============================================================================
-- BUSINESS SETTINGS  (single row — controls default hours & slot interval)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.business_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_start_time   TIME NOT NULL DEFAULT '08:00',
  business_end_time     TIME NOT NULL DEFAULT '18:00',
  slot_interval_minutes INT NOT NULL DEFAULT 30 CHECK (slot_interval_minutes > 0),
  working_days          INT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6],  -- 1=Mon … 6=Sat, 0=Sun
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add staff_orders_enabled if this table was created by an older version of this migration
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS staff_orders_enabled BOOLEAN NOT NULL DEFAULT true;

-- Seed a single settings row (idempotent)
INSERT INTO public.business_settings (business_start_time, business_end_time, slot_interval_minutes, working_days, staff_orders_enabled)
SELECT '08:00', '18:00', 30, ARRAY[1,2,3,4,5,6], true
WHERE NOT EXISTS (SELECT 1 FROM public.business_settings);


-- =============================================================================
-- STAFF SCHEDULES  (recurring weekly working hours per staff member)
-- One row per staff per working day. Overridden by the shifts table for
-- specific calendar dates.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_of_week  INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun, 1=Mon … 6=Sat
  start_time   TIME NOT NULL DEFAULT '08:00',
  end_time     TIME NOT NULL DEFAULT '17:00',
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, day_of_week)
);


-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_staff_schedules_staff      ON public.staff_schedules(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_schedules_day        ON public.staff_schedules(day_of_week);


-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_settings','staff_schedules'] LOOP
    BEGIN
      EXECUTE format(
        'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at()', t
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END;
$$;


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.business_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_schedules    ENABLE ROW LEVEL SECURITY;

-- Business settings: public read (needed for frontend to know slot interval)
DROP POLICY IF EXISTS "business_settings: public read" ON public.business_settings;
CREATE POLICY "business_settings: public read"
  ON public.business_settings FOR SELECT USING (true);

-- Staff schedules: staff reads own, admin reads all (via service_role key — bypass)
DROP POLICY IF EXISTS "staff_schedules: staff reads own" ON public.staff_schedules;
CREATE POLICY "staff_schedules: staff reads own"
  ON public.staff_schedules FOR SELECT USING (staff_id = auth.uid());


-- =============================================================================
-- DONE
-- Next steps:
--   1. Paste this into Supabase SQL Editor and run it.
--   2. Add staff members (role = 'staff') via the admin users page.
--   3. Set their weekly schedules via Admin → Scheduling.
--   4. Bookings will now show dynamic available slots automatically.
-- =============================================================================
