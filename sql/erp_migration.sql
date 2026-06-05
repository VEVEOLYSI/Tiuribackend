-- =============================================================================
-- SALON ERP MIGRATION
-- Run AFTER primarysql.sql has been applied.
-- Safe to run once on an existing Supabase project.
-- =============================================================================


-- =============================================================================
-- NEW ENUMS
-- =============================================================================

DO $$ BEGIN CREATE TYPE public.leave_type AS ENUM ('annual','sick','unpaid','maternity','paternity'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.leave_status AS ENUM ('pending','approved','rejected','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.salary_type AS ENUM ('fixed','commission','hybrid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.inventory_txn_type AS ENUM ('stock_in','stock_out','adjustment','wastage','return'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.asset_status AS ENUM ('active','maintenance','retired','disposed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.payroll_status AS ENUM ('draft','approved','paid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- =============================================================================
-- FIX: relax payment_transactions constraint so checkout-at-payment works
-- (order is created AFTER successful payment in the checkout flow)
-- =============================================================================

ALTER TABLE public.payment_transactions DROP CONSTRAINT IF EXISTS payment_target;


-- =============================================================================
-- BRANCHES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.branches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  address    TEXT,
  phone      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PROFILE ENHANCEMENTS
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS branch_id          UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bio                TEXT,
  ADD COLUMN IF NOT EXISTS service_preferences TEXT[];


-- =============================================================================
-- SERVICE ENHANCEMENTS
-- =============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS deposit_percent  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (deposit_percent >= 0 AND deposit_percent <= 100),
  ADD COLUMN IF NOT EXISTS buffer_minutes   INT NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  ADD COLUMN IF NOT EXISTS category         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS required_skills  TEXT[];


-- =============================================================================
-- BOOKING ENHANCEMENTS
-- =============================================================================

ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS staff_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deposit_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS balance_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_walkin       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS branch_id       UUID REFERENCES public.branches(id) ON DELETE SET NULL;


-- =============================================================================
-- CLIENT NOTES  (per-client notes added by staff during/after service)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  staff_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  note       TEXT NOT NULL,
  is_flagged BOOLEAN NOT NULL DEFAULT false,   -- flag allergies / medical conditions
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- STAFF EXTENDED PROFILE  (HR details for role='staff' users)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id                      UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  national_id             TEXT,
  kra_pin                 TEXT,
  bank_name               TEXT,
  bank_account            TEXT,
  mpesa_number            TEXT,
  salary_type             public.salary_type NOT NULL DEFAULT 'commission',
  base_salary             NUMERIC(10,2),
  commission_pct          NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  hire_date               DATE,
  termination_date        DATE,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- SHIFTS  (work schedule)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.shifts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id  UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL,
  start_time TIME,
  end_time   TIME,
  is_day_off BOOLEAN NOT NULL DEFAULT false,
  notes      TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, shift_date)
);


-- =============================================================================
-- LEAVE REQUESTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.staff_leaves (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leave_type       public.leave_type NOT NULL,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  reason           TEXT,
  status           public.leave_status NOT NULL DEFAULT 'pending',
  approved_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- ATTENDANCE RECORDS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  record_date DATE NOT NULL,
  clock_in    TIMESTAMPTZ,
  clock_out   TIMESTAMPTZ,
  notes       TEXT,
  recorded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, record_date)
);


-- =============================================================================
-- COMMISSION RULES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.commission_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(100) NOT NULL,
  service_id     UUID REFERENCES public.services(id) ON DELETE CASCADE,
  role           public.user_role,
  commission_pct NUMERIC(5,2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 100),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- COMMISSION EARNINGS  (one row per completed booking per staff member)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.commission_earnings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  booking_id        UUID NOT NULL REFERENCES public.service_bookings(id) ON DELETE RESTRICT,
  rule_id           UUID REFERENCES public.commission_rules(id) ON DELETE SET NULL,
  service_amount    NUMERIC(10,2) NOT NULL,
  commission_pct    NUMERIC(5,2) NOT NULL,
  commission_amount NUMERIC(10,2) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | paid
  payroll_run_id    UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (staff_id, booking_id)
);


-- =============================================================================
-- PAYROLL RUNS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  status       public.payroll_status NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  approved_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ,
  paid_at      TIMESTAMPTZ,
  notes        TEXT,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE public.commission_earnings
    ADD CONSTRAINT fk_commission_payroll_run
    FOREIGN KEY (payroll_run_id) REFERENCES public.payroll_runs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- PAYROLL ITEMS  (one row per staff member per run)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payroll_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id   UUID NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  staff_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  base_salary      NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  deductions       NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_pay          NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method   VARCHAR(20),       -- bank | mpesa | cash
  payment_ref      TEXT,
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_run_id, staff_id)
);


-- =============================================================================
-- INVENTORY  (salon consumables — separate from retail products)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.inventory_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(200) NOT NULL,
  contact_name TEXT,
  email        TEXT,
  phone        TEXT,
  address      TEXT,
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id         UUID REFERENCES public.inventory_categories(id) ON DELETE SET NULL,
  supplier_id         UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  name                VARCHAR(200) NOT NULL,
  sku                 VARCHAR(50) UNIQUE,
  unit                VARCHAR(30) NOT NULL DEFAULT 'piece',   -- piece, ml, g, litre, pair
  unit_cost           NUMERIC(10,2),
  stock_quantity      NUMERIC(10,3) NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC(10,3) NOT NULL DEFAULT 5,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  type           public.inventory_txn_type NOT NULL,
  quantity       NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  unit_cost      NUMERIC(10,2),
  reference_id   UUID,
  reference_type VARCHAR(30),       -- booking | purchase_order | adjustment
  notes          TEXT,
  recorded_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  po_number    VARCHAR(20) NOT NULL UNIQUE,
  status       VARCHAR(20) NOT NULL DEFAULT 'draft',   -- draft | sent | received | cancelled
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  expected_at  DATE,
  received_at  TIMESTAMPTZ,
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  item_id           UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  quantity          NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  unit_cost         NUMERIC(10,2) NOT NULL CHECK (unit_cost >= 0),
  total_cost        NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  received_qty      NUMERIC(10,3) NOT NULL DEFAULT 0
);

-- Links which inventory items are consumed per service (for cost tracking)
CREATE TABLE IF NOT EXISTS public.service_inventory_usage (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  item_id    UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity   NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  UNIQUE (service_id, item_id)
);


-- =============================================================================
-- EXPENSES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
  branch_id    UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  description  TEXT NOT NULL,
  amount       NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL,
  receipt_url  TEXT,
  notes        TEXT,
  recorded_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- ASSETS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(200) NOT NULL,
  asset_number      VARCHAR(50) UNIQUE,
  category          VARCHAR(100),
  branch_id         UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  assigned_to       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  purchase_date     DATE,
  purchase_cost     NUMERIC(10,2),
  supplier_id       UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  status            public.asset_status NOT NULL DEFAULT 'active',
  useful_life_years INT,
  salvage_value     NUMERIC(10,2) DEFAULT 0,
  location          TEXT,
  serial_number     TEXT,
  notes             TEXT,
  next_service_date DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.asset_maintenance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  service_date  DATE NOT NULL,
  description   TEXT NOT NULL,
  cost          NUMERIC(10,2),
  performed_by  TEXT,
  next_due_date DATE,
  created_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_bookings_staff        ON public.service_bookings(staff_id);
CREATE INDEX IF NOT EXISTS idx_bookings_branch        ON public.service_bookings(branch_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_client    ON public.client_notes(client_id);
CREATE INDEX IF NOT EXISTS idx_client_notes_booking   ON public.client_notes(booking_id);
CREATE INDEX IF NOT EXISTS idx_shifts_staff_date      ON public.shifts(staff_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_date            ON public.shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_leaves_staff_status    ON public.staff_leaves(staff_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date  ON public.attendance_records(staff_id, record_date);
CREATE INDEX IF NOT EXISTS idx_comm_earn_staff        ON public.commission_earnings(staff_id);
CREATE INDEX IF NOT EXISTS idx_comm_earn_booking      ON public.commission_earnings(booking_id);
CREATE INDEX IF NOT EXISTS idx_comm_earn_status       ON public.commission_earnings(status);
CREATE INDEX IF NOT EXISTS idx_comm_earn_payroll      ON public.commission_earnings(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_run      ON public.payroll_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_staff    ON public.payroll_items(staff_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_category     ON public.inventory_items(category_id);
CREATE INDEX IF NOT EXISTS idx_inv_txns_item          ON public.inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_inv_txns_date          ON public.inventory_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_date          ON public.expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category      ON public.expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch        ON public.expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_assets_status          ON public.assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_branch          ON public.assets(branch_id);


-- =============================================================================
-- UPDATED_AT TRIGGERS FOR NEW TABLES
-- =============================================================================

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches','client_notes','staff_profiles','shifts','staff_leaves',
    'inventory_items','suppliers','purchase_orders','expenses','assets','payroll_runs'
  ] LOOP
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
-- TRIGGER: auto-compute commission when booking is marked completed
-- =============================================================================

CREATE OR REPLACE FUNCTION public.compute_booking_commission()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_rule public.commission_rules%ROWTYPE;
  v_sp   public.staff_profiles%ROWTYPE;
  v_pct  NUMERIC(5,2);
BEGIN
  IF OLD.status != 'completed' AND NEW.status = 'completed' AND NEW.staff_id IS NOT NULL THEN
    -- Service-specific rule first, then role-level rule, then staff default
    SELECT * INTO v_rule
    FROM public.commission_rules
    WHERE service_id = NEW.service_id AND is_active = true
    LIMIT 1;

    IF v_rule.id IS NULL THEN
      SELECT sp.* INTO v_sp
      FROM public.staff_profiles sp
      JOIN public.profiles p ON p.id = sp.id
      WHERE sp.id = NEW.staff_id;

      SELECT * INTO v_rule
      FROM public.commission_rules
      WHERE role = 'staff' AND service_id IS NULL AND is_active = true
      LIMIT 1;

      v_pct := COALESCE(v_rule.commission_pct, v_sp.commission_pct, 10);
    ELSE
      v_pct := v_rule.commission_pct;
    END IF;

    INSERT INTO public.commission_earnings (
      staff_id, booking_id, rule_id,
      service_amount, commission_pct, commission_amount, status
    ) VALUES (
      NEW.staff_id, NEW.id, v_rule.id,
      NEW.price, v_pct, ROUND(NEW.price * v_pct / 100, 2), 'pending'
    )
    ON CONFLICT (staff_id, booking_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_booking_commission
    AFTER UPDATE OF status ON public.service_bookings
    FOR EACH ROW EXECUTE FUNCTION public.compute_booking_commission();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- TRIGGER: update inventory stock quantity on transaction insert
-- =============================================================================

CREATE OR REPLACE FUNCTION public.apply_inventory_transaction()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE delta NUMERIC(10,3);
BEGIN
  IF NEW.type IN ('stock_in', 'return') THEN
    delta := ABS(NEW.quantity);
  ELSE
    delta := -ABS(NEW.quantity);
  END IF;
  UPDATE public.inventory_items
  SET stock_quantity = stock_quantity + delta, updated_at = NOW()
  WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_inventory_transaction
    AFTER INSERT ON public.inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_transaction();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- =============================================================================
-- FUNCTION: generate purchase order number
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  seq   INT;
  today TEXT := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
BEGIN
  SELECT COUNT(*) + 1 INTO seq
  FROM public.purchase_orders
  WHERE DATE(created_at) = CURRENT_DATE;
  RETURN 'PO-' || today || '-' || LPAD(seq::TEXT, 4, '0');
END;
$$;


-- =============================================================================
-- VIEWS
-- =============================================================================

-- Staff daily schedule (bookings assigned to each staff member)
CREATE OR REPLACE VIEW public.staff_daily_schedule AS
SELECT
  sb.id,
  sb.booking_number,
  sb.scheduled_date,
  sb.scheduled_time,
  sb.status,
  sb.price,
  sb.deposit_amount,
  sb.balance_amount,
  sb.is_walkin,
  sb.staff_id,
  sb.user_id       AS customer_id,
  s.name           AS service_name,
  s.duration_minutes,
  pr.name          AS customer_name,
  sp.name          AS staff_name
FROM      public.service_bookings sb
JOIN      public.services         s  ON s.id  = sb.service_id
JOIN      public.profiles         pr ON pr.id = sb.user_id
LEFT JOIN public.profiles         sp ON sp.id = sb.staff_id
WHERE sb.status NOT IN ('cancelled');

-- Monthly P&L (requires daily_revenue view from primarysql.sql)
CREATE OR REPLACE VIEW public.pl_monthly AS
SELECT
  DATE_TRUNC('month', d.day)::DATE                  AS month,
  SUM(d.revenue)                                    AS total_revenue,
  COALESCE(e.total_expenses, 0)                     AS total_expenses,
  SUM(d.revenue) - COALESCE(e.total_expenses, 0)    AS net_profit
FROM public.daily_revenue d
LEFT JOIN (
  SELECT DATE_TRUNC('month', expense_date)::DATE AS month,
         SUM(amount)                              AS total_expenses
  FROM public.expenses
  GROUP BY 1
) e ON e.month = DATE_TRUNC('month', d.day)::DATE
GROUP BY DATE_TRUNC('month', d.day)::DATE, e.total_expenses
ORDER BY month DESC;

-- Staff performance summary
CREATE OR REPLACE VIEW public.staff_performance AS
SELECT
  p.id                                                                         AS staff_id,
  p.name                                                                       AS staff_name,
  COUNT(sb.id) FILTER (WHERE sb.status = 'completed')                          AS completed,
  COUNT(sb.id) FILTER (WHERE sb.status = 'no_show')                            AS no_shows,
  COUNT(sb.id) FILTER (WHERE sb.status = 'cancelled')                          AS cancellations,
  COALESCE(SUM(sb.price) FILTER (WHERE sb.status = 'completed'), 0)            AS revenue_generated,
  COALESCE(SUM(ce.commission_amount) FILTER (WHERE ce.status = 'pending'), 0)  AS pending_commission,
  COALESCE(SUM(ce.commission_amount) FILTER (WHERE ce.status = 'paid'), 0)     AS paid_commission
FROM      public.profiles          p
LEFT JOIN public.service_bookings  sb ON sb.staff_id = p.id
LEFT JOIN public.commission_earnings ce ON ce.staff_id = p.id
WHERE p.role = 'staff' AND p.deleted_at IS NULL
GROUP BY p.id, p.name;


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE public.branches               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leaves           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_earnings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_inventory_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_maintenance      ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "branches: public read active"  ON public.branches FOR SELECT USING (is_active = true);
CREATE POLICY "inv_cats: public read"         ON public.inventory_categories FOR SELECT USING (true);
CREATE POLICY "exp_cats: public read"         ON public.expense_categories FOR SELECT USING (true);

-- Staff self-service policies
CREATE POLICY "client_notes: client reads own"       ON public.client_notes FOR SELECT USING (client_id = auth.uid());
CREATE POLICY "staff_profiles: staff reads own"      ON public.staff_profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "shifts: staff reads own"              ON public.shifts FOR SELECT USING (staff_id = auth.uid());
CREATE POLICY "leaves: staff manages own"            ON public.staff_leaves FOR ALL USING (staff_id = auth.uid());
CREATE POLICY "attendance: staff reads own"          ON public.attendance_records FOR SELECT USING (staff_id = auth.uid());
CREATE POLICY "comm_earnings: staff reads own"       ON public.commission_earnings FOR SELECT USING (staff_id = auth.uid());
CREATE POLICY "payroll_items: staff reads own"       ON public.payroll_items FOR SELECT USING (staff_id = auth.uid());

-- All remaining tables (inventory, expenses, assets, suppliers, etc.) are
-- admin-only and accessed exclusively via the service_role key (supabaseAdmin
-- bypasses RLS). No client-side RLS needed.


-- =============================================================================
-- SEED DATA
-- =============================================================================

INSERT INTO public.expense_categories (name) VALUES
  ('Rent'), ('Utilities'), ('Supplies & Products'), ('Staff Costs'),
  ('Marketing'), ('Equipment'), ('Repairs & Maintenance'), ('Other')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.inventory_categories (name) VALUES
  ('Nail Products'), ('Hair Products'), ('Cleaning & Sanitization'),
  ('Tools & Equipment Consumables'), ('Skin Care'), ('Other')
ON CONFLICT (name) DO NOTHING;


-- =============================================================================
-- DONE
-- Next steps:
--   1. Run this in Supabase SQL Editor after primarysql.sql
--   2. Create a staff_profile row for each staff member via the HR module
--   3. Define commission_rules for your services
--   4. Set deposit_percent on services that require deposits
-- =============================================================================
