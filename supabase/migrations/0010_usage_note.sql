-- Split the "vocab note" out of the definition.
--
-- explanation used to be "definition, then one usage note", which forced the model
-- to invent a usage note for every word — including the boring ones — so the note
-- read as filler. As its own nullable column it appears only when the word has a
-- genuine trap (false friend, fixed collocation, register), and the card hides the
-- section entirely when it is null.
--
--   explanation   -> Значення     (always)
--   grammar_note  -> Граматика    (only when it says something the card doesn't already show)
--   usage_note    -> Варто знати  (only when there is a real trap)
--
-- Existing senses get null; they keep their current explanation until re-identified.
alter table word_senses
  add column if not exists usage_note text;
