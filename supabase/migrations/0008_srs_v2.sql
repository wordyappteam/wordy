-- SRS v2: schedule-step model on word_senses.
-- interval_step is the single source of truth; learning_stage (text) is kept in
-- sync as a derived convenience for existing badge queries. Additive + safe:
-- nothing reads these columns until the v2 engine is wired in.

alter table public.word_senses
  add column if not exists interval_step    integer not null default 0,
  add column if not exists lapses           integer not null default 0,
  add column if not exists slipped          boolean not null default false,
  add column if not exists is_leech         boolean not null default false,
  add column if not exists last_reviewed    date,
  add column if not exists next_review_date date;

-- Seed interval_step from any existing text learning_stage so senses already in
-- flight keep their level. Stage -> representative step:
--   new 0 | early 1 | mid 3 | late 5 | known 6 | mastered 8
update public.word_senses
set interval_step = case learning_stage
    when 'new'      then 0
    when 'early'    then 1
    when 'mid'      then 3
    when 'late'     then 5
    when 'known'    then 6
    when 'mastered' then 8
    else 0
  end
where interval_step = 0 and learning_stage is not null;

-- Words become due immediately on first run (no schedule yet) — harmless; the
-- engine reschedules them on their next session.
