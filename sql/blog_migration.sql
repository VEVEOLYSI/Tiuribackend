-- Run this in your database SQL editor to enable the blog feature

CREATE TABLE IF NOT EXISTS blog_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  content       TEXT NOT NULL,
  excerpt       TEXT,
  cover_image   TEXT,
  author_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  is_published  BOOLEAN NOT NULL DEFAULT false,
  published_at  TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS blog_posts_slug_idx ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS blog_posts_published_idx ON blog_posts(is_published, published_at DESC);
