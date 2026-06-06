-- Run this in Supabase SQL editor to enable the blog feature

create table if not exists public.blog_posts (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  slug          text not null unique,
  content       text not null,
  excerpt       text,
  cover_image   text,
  author_id     uuid references public.profiles(id) on delete set null,
  is_published  boolean not null default false,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists blog_posts_slug_idx on public.blog_posts(slug);
create index if not exists blog_posts_published_idx on public.blog_posts(is_published, published_at desc);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists blog_posts_updated_at on public.blog_posts;
create trigger blog_posts_updated_at
  before update on public.blog_posts
  for each row execute function update_updated_at();

-- RLS: anyone can read published posts, only service role can write
alter table public.blog_posts enable row level security;

create policy "public read published posts"
  on public.blog_posts for select
  using (is_published = true and deleted_at is null);
