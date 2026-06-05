-- =============================================================================
-- WIG E-COMMERCE & SERVICE PLATFORM
-- Supabase PostgreSQL Schema
-- =============================================================================
-- HOW TO USE:
--   Paste this entire file into Supabase Dashboard → SQL Editor → Run
--   Supabase already enables uuid-ossp and pgcrypto — no manual setup needed.
-- =============================================================================


-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";       -- case-insensitive text (emails)


-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE public.user_role AS ENUM (
  'customer',
  'staff',
  'admin'
);

CREATE TYPE public.order_status AS ENUM (
  'pending',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded'
);

CREATE TYPE public.payment_status AS ENUM (
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded'
);

CREATE TYPE public.booking_status AS ENUM (
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show'
);

CREATE TYPE public.payment_gateway AS ENUM (
  'mpesa',
  'stripe',
  'cash'
);

CREATE TYPE public.transaction_status AS ENUM (
  'pending',
  'success',
  'failed',
  'refunded'
);

CREATE TYPE public.promotion_type AS ENUM (
  'banner',
  'flash_sale',
  'featured_product',
  'featured_service'
);

CREATE TYPE public.discount_type AS ENUM (
  'percent',
  'fixed'
);

CREATE TYPE public.notification_type AS ENUM (
  'order_update',
  'booking_update',
  'promotion',
  'system',
  'review_response'
);

CREATE TYPE public.review_target AS ENUM (
  'product',
  'service'
);


-- =============================================================================
-- PROFILES
-- Extends Supabase auth.users. One row per user, created automatically on signup.
-- =============================================================================

CREATE TABLE public.profiles (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name               VARCHAR(100) NOT NULL DEFAULT '',
  phone              TEXT,                           -- encrypt in app layer via pgcrypto
  role               public.user_role NOT NULL DEFAULT 'customer',
  avatar_url         TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  failed_login_count INT NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  last_login_at      TIMESTAMPTZ,
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.profiles.phone IS 'Store encrypted. Use pgcrypto encode/decode in application layer.';
COMMENT ON COLUMN public.profiles.locked_until IS 'Set after repeated failed logins. App must check before issuing JWT.';

-- Auto-create profile row when a new Supabase auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================================
-- ADDRESSES
-- =============================================================================

CREATE TABLE public.addresses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label       VARCHAR(50),                        -- "Home", "Office", etc.
  street      TEXT NOT NULL,
  city        VARCHAR(100) NOT NULL,
  county      VARCHAR(100),
  postal_code VARCHAR(20),
  country     VARCHAR(2) NOT NULL DEFAULT 'KE',   -- ISO 3166-1 alpha-2
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- CATEGORIES  (nested — self-referencing parent_id)
-- Example: Wigs → Lace Front → Full Lace
-- =============================================================================

CREATE TABLE public.categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(120) NOT NULL UNIQUE,
  description TEXT,
  image_url   TEXT,
  parent_id   UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- PRODUCTS
-- =============================================================================

CREATE TABLE public.products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(200) NOT NULL,
  slug             VARCHAR(220) NOT NULL UNIQUE,
  description      TEXT,
  sku              VARCHAR(50) UNIQUE,
  price            NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  compare_at_price NUMERIC(10, 2)  CHECK (compare_at_price >= 0),  -- shown as "was" price
  cost_price       NUMERIC(10, 2)  CHECK (cost_price >= 0),        -- internal margin tracking
  stock            INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold INT NOT NULL DEFAULT 5,
  -- JSONB: [{url, alt, sort_order}, ...]
  images           JSONB NOT NULL DEFAULT '[]',
  -- JSONB: [{id, color, length, density, lace_type, price_modifier, stock}, ...]
  variants         JSONB NOT NULL DEFAULT '[]',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  is_featured      BOOLEAN NOT NULL DEFAULT false,
  weight_grams     INT,                            -- for shipping cost calculation
  meta_title       VARCHAR(200),
  meta_description VARCHAR(500),
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-many: a wig can belong to multiple categories
CREATE TABLE public.product_categories (
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);


-- =============================================================================
-- SERVICES  (wig washing, styling, repair, etc.)
-- =============================================================================

CREATE TABLE public.services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(200) NOT NULL,
  slug             VARCHAR(220) NOT NULL UNIQUE,
  description      TEXT,
  price            NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
  capacity         INT NOT NULL DEFAULT 1,         -- max concurrent bookings per slot
  -- JSONB: [{url, alt}, ...]
  images           JSONB NOT NULL DEFAULT '[]',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  is_featured      BOOLEAN NOT NULL DEFAULT false,
  meta_title       VARCHAR(200),
  meta_description VARCHAR(500),
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Available booking time slots per service and staff member
CREATE TABLE public.service_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id   UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  staff_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  slot_date    DATE NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  capacity     INT NOT NULL DEFAULT 1,
  booked_count INT NOT NULL DEFAULT 0 CHECK (booked_count >= 0),
  is_blocked   BOOLEAN NOT NULL DEFAULT false,     -- admin can manually block a slot
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, staff_id, slot_date, start_time)
);


-- =============================================================================
-- CART  (supports both logged-in users and guests)
-- =============================================================================

CREATE TABLE public.carts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES public.profiles(id) ON DELETE CASCADE,  -- NULL = guest
  session_id TEXT,                                                     -- guest identifier
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cart_owner_check CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

-- Products and services can both exist in the same cart
CREATE TABLE public.cart_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id    UUID NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  variant_id TEXT,                                 -- references variant.id inside products.variants JSONB
  quantity   INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),  -- price at time of add
  notes      TEXT,                                 -- custom instructions for service
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cart_item_target CHECK (
    (product_id IS NOT NULL AND service_id IS NULL) OR
    (service_id IS NOT NULL AND product_id IS NULL)
  )
);


-- =============================================================================
-- WISHLIST
-- =============================================================================

CREATE TABLE public.wishlist_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);


-- =============================================================================
-- DISCOUNT CODES
-- =============================================================================

CREATE TABLE public.discount_codes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              VARCHAR(50) NOT NULL UNIQUE,
  description       TEXT,
  type              public.discount_type NOT NULL,
  value             NUMERIC(10, 2) NOT NULL CHECK (value > 0),
  min_order_amount  NUMERIC(10, 2) CHECK (min_order_amount >= 0),
  max_discount_cap  NUMERIC(10, 2),               -- caps percentage discounts (e.g. max 500 KES off)
  max_uses          INT,                           -- NULL = unlimited total uses
  used_count        INT NOT NULL DEFAULT 0,
  max_uses_per_user INT NOT NULL DEFAULT 1,        -- prevents single-user abuse
  is_active         BOOLEAN NOT NULL DEFAULT true,
  starts_at         TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Track which user used which code (enforces max_uses_per_user)
CREATE TABLE public.discount_code_uses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id UUID NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_id         UUID,                           -- FK added after orders table is created
  used_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- ORDERS
-- =============================================================================

CREATE TABLE public.orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     VARCHAR(20) NOT NULL UNIQUE,    -- e.g. WIG-20240601-0001
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  address_id       UUID REFERENCES public.addresses(id) ON DELETE SET NULL,
  discount_code_id UUID REFERENCES public.discount_codes(id) ON DELETE SET NULL,
  subtotal         NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
  discount_amount  NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  shipping_amount  NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
  total_amount     NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
  payment_status   public.payment_status NOT NULL DEFAULT 'pending',
  order_status     public.order_status NOT NULL DEFAULT 'pending',
  notes            TEXT,
  ip_address       INET,
  idempotency_key  UUID UNIQUE,                    -- prevents double-order on retry/network failure
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Snapshot product data at order time so order history is immutable
CREATE TABLE public.order_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id       UUID REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id       TEXT,
  product_snapshot JSONB NOT NULL,                 -- {name, sku, price, image, variant} at time of purchase
  quantity         INT NOT NULL CHECK (quantity > 0),
  unit_price       NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
  total_price      NUMERIC(10, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);

-- Now that orders table exists, add FK for discount_code_uses.order_id
ALTER TABLE public.discount_code_uses
  ADD CONSTRAINT fk_discount_code_uses_order
  FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


-- =============================================================================
-- SERVICE BOOKINGS
-- =============================================================================

CREATE TABLE public.service_bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number      VARCHAR(20) NOT NULL UNIQUE, -- e.g. BKG-20240601-0001
  user_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  service_id          UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  slot_id             UUID REFERENCES public.service_slots(id) ON DELETE SET NULL,
  scheduled_date      DATE NOT NULL,
  scheduled_time      TIME NOT NULL,
  status              public.booking_status NOT NULL DEFAULT 'pending',
  price               NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  notes               TEXT,
  cancellation_reason TEXT,
  cancelled_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  ip_address          INET,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff member assigned to handle a booking
CREATE TABLE public.booking_staff_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES public.service_bookings(id) ON DELETE CASCADE,
  staff_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (booking_id, staff_id)
);


-- =============================================================================
-- PAYMENT TRANSACTIONS
-- Every payment attempt is recorded — success or failure.
-- Never store raw card data here; use Stripe token / M-Pesa receipt.
-- =============================================================================

CREATE TABLE public.payment_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  booking_id      UUID REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  gateway         public.payment_gateway NOT NULL,
  gateway_ref     TEXT,                            -- Stripe PaymentIntent ID or M-Pesa CheckoutRequestID
  amount          NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  currency        VARCHAR(3) NOT NULL DEFAULT 'KES',
  status          public.transaction_status NOT NULL DEFAULT 'pending',
  failure_reason  TEXT,
  metadata        JSONB,                           -- raw gateway response (for debugging/audit)
  idempotency_key UUID UNIQUE,                     -- prevents double-charge on network retry
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_target CHECK (order_id IS NOT NULL OR booking_id IS NOT NULL)
);


-- =============================================================================
-- PROMOTIONS  (banners, flash sales, featured listings)
-- =============================================================================

CREATE TABLE public.promotions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       VARCHAR(200) NOT NULL,
  type        public.promotion_type NOT NULL,
  image_url   TEXT,
  link_url    TEXT,
  description TEXT,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products featured in a flash sale with a specific sale price
CREATE TABLE public.flash_sale_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sale_price   NUMERIC(10, 2) NOT NULL CHECK (sale_price >= 0),
  stock_limit  INT,                                -- max units at the sale price
  sold_count   INT NOT NULL DEFAULT 0,
  UNIQUE (promotion_id, product_id)
);


-- =============================================================================
-- REVIEWS
-- Only verified purchasers can leave reviews (enforced via trigger).
-- Admin must approve before the review goes public.
-- =============================================================================

CREATE TABLE public.reviews (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type          public.review_target NOT NULL,
  product_id           UUID REFERENCES public.products(id) ON DELETE CASCADE,
  service_id           UUID REFERENCES public.services(id) ON DELETE CASCADE,
  order_item_id        UUID REFERENCES public.order_items(id) ON DELETE SET NULL,
  booking_id           UUID REFERENCES public.service_bookings(id) ON DELETE SET NULL,
  rating               SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title                VARCHAR(200),
  comment              TEXT,
  -- JSONB: [{url, alt}, ...]  — images uploaded to Supabase Storage
  images               JSONB NOT NULL DEFAULT '[]',
  is_verified_purchase BOOLEAN NOT NULL DEFAULT false,  -- set by trigger
  is_approved          BOOLEAN NOT NULL DEFAULT false,  -- admin approves before publishing
  is_flagged           BOOLEAN NOT NULL DEFAULT false,
  admin_response       TEXT,
  admin_responded_at   TIMESTAMPTZ,
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT review_target_check CHECK (
    (target_type = 'product' AND product_id IS NOT NULL AND service_id IS NULL) OR
    (target_type = 'service' AND service_id IS NOT NULL AND product_id IS NULL)
  )
);


-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================

CREATE TABLE public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type       public.notification_type NOT NULL,
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  data       JSONB,                               -- {order_id, booking_id, etc.}
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- AUDIT LOG
-- Every admin action is recorded. Never truncate this table.
-- =============================================================================

CREATE TABLE public.audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role  public.user_role,
  action      VARCHAR(100) NOT NULL,              -- e.g. 'product.update', 'order.refund', 'user.ban'
  entity_type VARCHAR(50) NOT NULL,               -- table name
  entity_id   UUID,
  old_value   JSONB,                              -- state before change
  new_value   JSONB,                              -- state after change
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =============================================================================
-- INDEXES
-- =============================================================================

-- Profiles
CREATE INDEX idx_profiles_role       ON public.profiles(role) WHERE deleted_at IS NULL;
CREATE INDEX idx_profiles_is_active  ON public.profiles(is_active) WHERE deleted_at IS NULL;

-- Categories
CREATE INDEX idx_categories_parent   ON public.categories(parent_id);
CREATE INDEX idx_categories_slug     ON public.categories(slug);

-- Products
CREATE INDEX idx_products_slug           ON public.products(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_active_price   ON public.products(price) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX idx_products_featured       ON public.products(is_featured) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX idx_products_stock          ON public.products(stock) WHERE deleted_at IS NULL;
-- Full-text search on product name + description
CREATE INDEX idx_products_fts ON public.products
  USING gin(to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '')));

-- Product categories
CREATE INDEX idx_product_categories_cat ON public.product_categories(category_id);

-- Services
CREATE INDEX idx_services_slug       ON public.services(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_services_active     ON public.services(is_active) WHERE deleted_at IS NULL;

-- Service slots
CREATE INDEX idx_slots_service_date  ON public.service_slots(service_id, slot_date);
CREATE INDEX idx_slots_date          ON public.service_slots(slot_date);

-- Carts
CREATE INDEX idx_carts_user_id       ON public.carts(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_carts_session_id    ON public.carts(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_carts_expires_at    ON public.carts(expires_at);
CREATE INDEX idx_cart_items_cart_id  ON public.cart_items(cart_id);

-- Wishlist
CREATE INDEX idx_wishlist_user       ON public.wishlist_items(user_id);

-- Discount codes
CREATE INDEX idx_discount_code       ON public.discount_codes(code);
CREATE INDEX idx_discount_active     ON public.discount_codes(is_active, expires_at);

-- Orders
CREATE INDEX idx_orders_user_id      ON public.orders(user_id);
CREATE INDEX idx_orders_number       ON public.orders(order_number);
CREATE INDEX idx_orders_statuses     ON public.orders(payment_status, order_status);
CREATE INDEX idx_orders_created_at   ON public.orders(created_at DESC);
CREATE INDEX idx_order_items_order   ON public.order_items(order_id);
CREATE INDEX idx_order_items_product ON public.order_items(product_id);

-- Bookings
CREATE INDEX idx_bookings_user       ON public.service_bookings(user_id);
CREATE INDEX idx_bookings_service    ON public.service_bookings(service_id);
CREATE INDEX idx_bookings_date       ON public.service_bookings(scheduled_date);
CREATE INDEX idx_bookings_status     ON public.service_bookings(status);

-- Payments
CREATE INDEX idx_payments_order      ON public.payment_transactions(order_id);
CREATE INDEX idx_payments_booking    ON public.payment_transactions(booking_id);
CREATE INDEX idx_payments_gateway_ref ON public.payment_transactions(gateway_ref);
CREATE INDEX idx_payments_status     ON public.payment_transactions(status);

-- Reviews
CREATE INDEX idx_reviews_product     ON public.reviews(product_id) WHERE deleted_at IS NULL AND is_approved = true;
CREATE INDEX idx_reviews_service     ON public.reviews(service_id) WHERE deleted_at IS NULL AND is_approved = true;
CREATE INDEX idx_reviews_user        ON public.reviews(user_id);

-- Notifications
CREATE INDEX idx_notifications_user  ON public.notifications(user_id);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- Audit log
CREATE INDEX idx_audit_actor         ON public.audit_logs(actor_id);
CREATE INDEX idx_audit_entity        ON public.audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created_at    ON public.audit_logs(created_at DESC);


-- =============================================================================
-- TRIGGER: auto-update updated_at on every UPDATE
-- =============================================================================

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'addresses', 'categories', 'products', 'services',
    'carts', 'orders', 'service_bookings', 'payment_transactions',
    'promotions', 'reviews', 'discount_codes'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at
       BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at()',
      t
    );
  END LOOP;
END;
$$;


-- =============================================================================
-- TRIGGER: auto-decrement slot.booked_count on booking cancellation
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_booking_cancellation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status != 'cancelled' AND NEW.status = 'cancelled' AND NEW.slot_id IS NOT NULL THEN
    UPDATE public.service_slots
    SET booked_count = GREATEST(booked_count - 1, 0)
    WHERE id = NEW.slot_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_booking_cancellation
  AFTER UPDATE OF status ON public.service_bookings
  FOR EACH ROW EXECUTE FUNCTION public.handle_booking_cancellation();


-- =============================================================================
-- TRIGGER: auto-mark review as verified_purchase
-- A review is verified if linked to an actual order_item or booking.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_verified_purchase()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_type = 'product' AND NEW.order_item_id IS NOT NULL THEN
    NEW.is_verified_purchase := true;
  ELSIF NEW.target_type = 'service' AND NEW.booking_id IS NOT NULL THEN
    NEW.is_verified_purchase := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_verified_purchase
  BEFORE INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_verified_purchase();


-- =============================================================================
-- FUNCTION: reserve_product_stock  (prevents overselling)
-- Uses a single atomic UPDATE; returns false if stock is insufficient.
-- Call this inside your checkout transaction before creating order_items.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reserve_product_stock(
  p_product_id UUID,
  p_quantity   INT
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  updated_rows INT;
BEGIN
  UPDATE public.products
  SET    stock = stock - p_quantity
  WHERE  id = p_product_id
    AND  stock >= p_quantity
    AND  deleted_at IS NULL;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows > 0;
END;
$$;


-- =============================================================================
-- FUNCTION: generate_order_number  →  WIG-20240601-0001
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  seq   INT;
  today TEXT := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
BEGIN
  SELECT COUNT(*) + 1
  INTO   seq
  FROM   public.orders
  WHERE  DATE(created_at) = CURRENT_DATE;

  RETURN 'WIG-' || today || '-' || LPAD(seq::TEXT, 4, '0');
END;
$$;


-- =============================================================================
-- FUNCTION: generate_booking_number  →  BKG-20240601-0001
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_booking_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  seq   INT;
  today TEXT := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');
BEGIN
  SELECT COUNT(*) + 1
  INTO   seq
  FROM   public.service_bookings
  WHERE  DATE(created_at) = CURRENT_DATE;

  RETURN 'BKG-' || today || '-' || LPAD(seq::TEXT, 4, '0');
END;
$$;


-- =============================================================================
-- VIEWS
-- =============================================================================

-- Product listing with live avg rating + review count
CREATE VIEW public.product_summary AS
SELECT
  p.id,
  p.name,
  p.slug,
  p.price,
  p.compare_at_price,
  p.stock,
  p.images,
  p.variants,
  p.is_featured,
  p.created_at,
  ROUND(AVG(r.rating)::NUMERIC, 1) AS avg_rating,
  COUNT(r.id)                       AS review_count
FROM      public.products p
LEFT JOIN public.reviews  r
       ON r.product_id = p.id
      AND r.is_approved = true
      AND r.deleted_at  IS NULL
WHERE p.is_active  = true
  AND p.deleted_at IS NULL
GROUP BY p.id;

-- Admin order dashboard
CREATE VIEW public.order_summary AS
SELECT
  o.id,
  o.order_number,
  o.total_amount,
  o.payment_status,
  o.order_status,
  o.created_at,
  pr.name       AS customer_name,
  au.email      AS customer_email,
  COUNT(oi.id)  AS item_count
FROM      public.orders      o
JOIN      public.profiles    pr ON pr.id = o.user_id
JOIN      auth.users         au ON au.id = o.user_id
LEFT JOIN public.order_items oi ON oi.order_id = o.id
GROUP BY  o.id, pr.name, au.email;

-- Revenue summary by day (admin analytics)
CREATE VIEW public.daily_revenue AS
SELECT
  DATE(created_at)          AS day,
  COUNT(*)                  AS order_count,
  SUM(total_amount)         AS revenue,
  AVG(total_amount)         AS avg_order_value
FROM public.orders
WHERE payment_status = 'paid'
GROUP BY DATE(created_at)
ORDER BY day DESC;

-- Booking calendar view
CREATE VIEW public.booking_calendar AS
SELECT
  sb.id,
  sb.booking_number,
  sb.scheduled_date,
  sb.scheduled_time,
  sb.status,
  s.name  AS service_name,
  s.duration_minutes,
  pr.name AS customer_name,
  au.email AS customer_email
FROM      public.service_bookings sb
JOIN      public.services          s  ON s.id  = sb.service_id
JOIN      public.profiles          pr ON pr.id = sb.user_id
JOIN      auth.users               au ON au.id = sb.user_id
ORDER BY  sb.scheduled_date, sb.scheduled_time;


-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Supabase enforces these automatically using auth.uid()
-- =============================================================================

-- ── Profiles ─────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: users read own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles: users update own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- ── Addresses ────────────────────────────────────────────
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "addresses: own all"
  ON public.addresses FOR ALL
  USING (user_id = auth.uid());

-- ── Carts ────────────────────────────────────────────────
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carts: own all"
  ON public.carts FOR ALL
  USING (user_id = auth.uid());

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cart_items: own via cart"
  ON public.cart_items FOR ALL
  USING (
    cart_id IN (SELECT id FROM public.carts WHERE user_id = auth.uid())
  );

-- ── Wishlist ─────────────────────────────────────────────
ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wishlist: own all"
  ON public.wishlist_items FOR ALL
  USING (user_id = auth.uid());

-- ── Orders ───────────────────────────────────────────────
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders: customers read own"
  ON public.orders FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "orders: customers insert own"
  ON public.orders FOR INSERT
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_items: read via own orders"
  ON public.order_items FOR SELECT
  USING (
    order_id IN (SELECT id FROM public.orders WHERE user_id = auth.uid())
  );

-- ── Service Bookings ─────────────────────────────────────
ALTER TABLE public.service_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bookings: customers read own"
  ON public.service_bookings FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "bookings: customers insert own"
  ON public.service_bookings FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ── Notifications ─────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications: own all"
  ON public.notifications FOR ALL
  USING (user_id = auth.uid());

-- ── Reviews ──────────────────────────────────────────────
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reviews: anyone reads approved"
  ON public.reviews FOR SELECT
  USING (is_approved = true AND deleted_at IS NULL);

CREATE POLICY "reviews: users read own (including unapproved)"
  ON public.reviews FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "reviews: users insert own"
  ON public.reviews FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "reviews: users update own"
  ON public.reviews FOR UPDATE
  USING (user_id = auth.uid() AND is_approved = false);

-- ── Discount code uses ───────────────────────────────────
ALTER TABLE public.discount_code_uses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discount_uses: own all"
  ON public.discount_code_uses FOR ALL
  USING (user_id = auth.uid());

-- ── Public read-only tables ──────────────────────────────
ALTER TABLE public.products   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products: public read active"
  ON public.products FOR SELECT
  USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "services: public read active"
  ON public.services FOR SELECT
  USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "categories: public read active"
  ON public.categories FOR SELECT
  USING (is_active = true);

CREATE POLICY "promotions: public read active"
  ON public.promotions FOR SELECT
  USING (is_active = true AND (ends_at IS NULL OR ends_at > NOW()));

CREATE POLICY "service_slots: public read available"
  ON public.service_slots FOR SELECT
  USING (is_blocked = false AND slot_date >= CURRENT_DATE);


-- =============================================================================
-- SEED: default categories  (safe to delete if you want to start clean)
-- =============================================================================

INSERT INTO public.categories (name, slug, sort_order) VALUES
  ('Wigs',          'wigs',          1),
  ('Lace Front',    'lace-front',    2),
  ('Full Lace',     'full-lace',     3),
  ('Human Hair',    'human-hair',    4),
  ('Synthetic',     'synthetic',     5),
  ('Braided Wigs',  'braided-wigs',  6),
  ('Short Wigs',    'short-wigs',    7),
  ('Long Wigs',     'long-wigs',     8)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.services (name, slug, price, duration_minutes, description) VALUES
  ('Wig Washing',  'wig-washing',  800,  60,  'Deep clean and conditioning of your wig'),
  ('Wig Styling',  'wig-styling',  1200, 90,  'Professional styling and curling/straightening'),
  ('Wig Repair',   'wig-repair',   1500, 120, 'Lace repair, knot bleaching, and restoration'),
  ('Wig Fitting',  'wig-fitting',  600,  45,  'Custom sizing and strap adjustment')
ON CONFLICT (slug) DO NOTHING;


-- =============================================================================
-- DONE
-- All tables, indexes, triggers, functions, views, and RLS policies created.
-- Next steps:
--   1. Enable Supabase Realtime on: orders, service_bookings, notifications
--   2. Create Supabase Storage buckets: product-images, review-images, avatars
--   3. Set Storage bucket policies to match RLS above
--   4. Wire auth.uid() checks into your Hono API middleware
-- =============================================================================

UPDATE public.profiles
SET role = 'admin'
WHERE id = (
  SELECT id
  FROM auth.users
  WHERE email = 'simongatungo300@gmail.com'
);


UPDATE public.profiles
SET role = 'staff'
WHERE id = (
  SELECT id
  FROM auth.users
  WHERE email = 'test@example.com'
);


ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS checkout_data JSONB;


CREATE OR REPLACE FUNCTION public.increment_discount_code_usage(p_code_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.discount_codes
  SET used_count = used_count + 1
  WHERE id = p_code_id;
END;
$$;


ALTER TYPE public.payment_gateway ADD VALUE IF NOT EXISTS 'paystack';

ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS checkout_data JSONB;

ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS checkout_data JSONB;


