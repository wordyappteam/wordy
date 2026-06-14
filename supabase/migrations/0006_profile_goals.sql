-- Store the learner's onboarding goals on their profile.
-- Shape: { selected: ["fluency", ...], custom: "free text" | null,
--          parsed: { tags, summary, exam, deadline } | null,
--          exam?: { name, date } }   -- exam present only when the exam situation was chosen

alter table public.profiles
  add column if not exists goals jsonb;
