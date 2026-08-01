-- ============================================================
-- Homepage Images CMS
-- Stores Cloudinary-backed images for the Hero, Philosophy
-- (nails/wigs) and BookCTA sections of the public website.
-- ============================================================

CREATE TABLE IF NOT EXISTS homepage_images (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which homepage section this image belongs to
  section     text        NOT NULL
                CHECK (section IN ('hero', 'philosophy_nails', 'philosophy_wigs', 'cta')),

  -- Cloudinary delivery URL (secure_url)
  url         text        NOT NULL,

  -- Cloudinary public_id — needed to delete the asset
  public_id   text        NOT NULL UNIQUE,

  -- Original dimensions returned by Cloudinary
  width       int,
  height      int,

  -- Hero-card specific metadata (NULL for non-hero sections)
  label       text,     -- e.g. "NAILS", "WIGS", "SALON"
  caption     text,     -- card caption text shown on the slide
  href        text,     -- link target when visitor clicks the card

  -- Display order within the section (lower = first)
  sort_order  int         NOT NULL DEFAULT 0,

  is_active   boolean     NOT NULL DEFAULT true,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS homepage_images_section_sort
  ON homepage_images (section, sort_order)
  WHERE is_active = true;

-- ── Auto-update updated_at ────────────────────────────────────
CREATE OR REPLACE FUNCTION update_homepage_images_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_homepage_images_updated_at ON homepage_images;
CREATE TRIGGER set_homepage_images_updated_at
  BEFORE UPDATE ON homepage_images
  FOR EACH ROW EXECUTE FUNCTION update_homepage_images_updated_at();

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE homepage_images ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated visitors) can read active rows
CREATE POLICY "homepage_images_public_read"
  ON homepage_images
  FOR SELECT
  USING (is_active = true);

-- Only the service-role key used by the backend can write
-- (all mutations go through the Hono API which uses service-role)
-- No INSERT / UPDATE / DELETE policies needed for anon/authenticated
-- roles because the backend always uses the service-role client.
