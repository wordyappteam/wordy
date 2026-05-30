-- Aspect + gender on word senses (Ukrainian)
-- Ukrainian verbs come in aspect pairs: imperfective (ongoing) + perfective
-- (completed), each stored as its own sense. Ukrainian nouns have grammatical
-- gender. Both null for non-applicable senses / other languages.
-- Run in the Supabase SQL editor.

alter table public.word_senses add column if not exists aspect text;
alter table public.word_senses add column if not exists gender text;
-- aspect: 'imperfective' | 'perfective' | null
-- gender: 'm' | 'f' | 'n' | null   (rendered as ч / ж / с for Ukrainian)
