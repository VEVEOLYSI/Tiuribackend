-- Migration: Add category and video_url columns to services table

ALTER TABLE public.services 
  ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS video_url TEXT DEFAULT NULL;

-- Create index on category for fast filtering
CREATE INDEX IF NOT EXISTS idx_services_category ON public.services(category) 
  WHERE deleted_at IS NULL;
