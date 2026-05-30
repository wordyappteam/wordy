-- Per-sense images (visual flashcards)
-- One optional image per word sense. Stored in the 'sense-images' Storage
-- bucket under {user_id}/..., with the public URL saved on the sense row.
-- Run in the Supabase SQL editor.

-- 1. Column on word_senses
alter table public.word_senses add column if not exists image_url text;

-- 2. Storage bucket (public read; uploads restricted by policy below)
insert into storage.buckets (id, name, public)
values ('sense-images', 'sense-images', true)
on conflict (id) do nothing;

-- 3. Storage policies: anyone can read; users manage only their own folder
drop policy if exists "Public read sense-images" on storage.objects;
create policy "Public read sense-images"
  on storage.objects for select
  using (bucket_id = 'sense-images');

drop policy if exists "Users upload own sense-images" on storage.objects;
create policy "Users upload own sense-images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sense-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update own sense-images" on storage.objects;
create policy "Users update own sense-images"
  on storage.objects for update to authenticated
  using (bucket_id = 'sense-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete own sense-images" on storage.objects;
create policy "Users delete own sense-images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'sense-images' and (storage.foldername(name))[1] = auth.uid()::text);
