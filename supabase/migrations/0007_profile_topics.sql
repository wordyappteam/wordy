-- Store the learner's topics of interest (selected + custom) on their profile.
-- A single jsonb string array, used to theme AI-generated example sentences.

alter table public.profiles
  add column if not exists topics jsonb;
