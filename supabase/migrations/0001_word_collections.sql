-- Word Collections
-- User-created, named groupings of dictionary words (e.g. colors, body parts).
-- User-chosen, never auto-generated semantic clusters. Scoped per target language.
-- Membership is at the WORD level; sessions resolve a collection to its word senses.
-- Run in the Supabase SQL editor.

create table if not exists public.collections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  color           text not null default 'indigo',
  target_language text not null default 'de',
  created_at      timestamptz not null default now()
);

create unique index if not exists collections_user_lang_name_key
  on public.collections (user_id, target_language, lower(name));

create index if not exists collections_user_lang_idx
  on public.collections (user_id, target_language);

create table if not exists public.word_collections (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid   not null references auth.users (id)         on delete cascade,
  collection_id uuid   not null references public.collections (id) on delete cascade,
  word_id       bigint not null references public.words (id)       on delete cascade,
  created_at    timestamptz not null default now(),
  unique (collection_id, word_id)
);

create index if not exists word_collections_collection_idx
  on public.word_collections (collection_id);

create index if not exists word_collections_word_idx
  on public.word_collections (word_id);

alter table public.collections      enable row level security;
alter table public.word_collections enable row level security;

drop policy if exists "Users can CRUD their own collections" on public.collections;
create policy "Users can CRUD their own collections"
  on public.collections for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can CRUD their own word_collections" on public.word_collections;
create policy "Users can CRUD their own word_collections"
  on public.word_collections for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
