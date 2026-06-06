import { supabaseAdmin } from '../config/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

export async function listPosts(opts: { publishedOnly?: boolean } = {}) {
  let q = supabaseAdmin
    .from('blog_posts')
    .select('id, title, slug, excerpt, cover_image, is_published, published_at, created_at, author:users(name)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (opts.publishedOnly) q = q.eq('is_published', true);

  const { data } = await q;
  return data ?? [];
}

export async function getPostBySlug(slug: string) {
  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .select('*, author:users(name, profile_image)')
    .eq('slug', slug)
    .eq('is_published', true)
    .is('deleted_at', null)
    .single();
  if (error || !data) throw new NotFoundError('Post');
  return data;
}

export async function getPostById(id: string) {
  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .select('*, author:users(name, profile_image)')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (error || !data) throw new NotFoundError('Post');
  return data;
}

export async function createPost(payload: {
  title: string; slug: string; content: string; excerpt?: string;
  coverImage?: string; isPublished?: boolean; authorId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .insert({
      title: payload.title,
      slug: payload.slug,
      content: payload.content,
      excerpt: payload.excerpt,
      cover_image: payload.coverImage,
      is_published: payload.isPublished ?? false,
      published_at: payload.isPublished ? new Date().toISOString() : null,
      author_id: payload.authorId,
    })
    .select()
    .single();
  if (error || !data) throw new BadRequestError(error?.message ?? 'Create failed');
  return data;
}

export async function updatePost(id: string, payload: Partial<{
  title: string; slug: string; content: string; excerpt: string;
  coverImage: string; isPublished: boolean;
}>) {
  const updates: Record<string, unknown> = {};
  if (payload.title !== undefined) updates.title = payload.title;
  if (payload.slug !== undefined) updates.slug = payload.slug;
  if (payload.content !== undefined) updates.content = payload.content;
  if (payload.excerpt !== undefined) updates.excerpt = payload.excerpt;
  if (payload.coverImage !== undefined) updates.cover_image = payload.coverImage;
  if (payload.isPublished !== undefined) {
    updates.is_published = payload.isPublished;
    if (payload.isPublished) updates.published_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();
  if (error || !data) throw new NotFoundError('Post');
  return data;
}

export async function deletePost(id: string) {
  const { error } = await supabaseAdmin
    .from('blog_posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);
  if (error) throw new NotFoundError('Post');
}
