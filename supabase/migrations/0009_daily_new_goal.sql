-- Daily new-word goal: how many new words the guided session may introduce per day.
-- Was a hardcoded constant (NEW_PER_DAY) in src/lib/dailyNew.js; pacing is a
-- learner decision, so it moves onto the profile.
-- Default 15 == the previous constant, so existing learners see no change until
-- they touch the stepper. Range is enforced in the UI (5..30, step 5).
alter table profiles
  add column if not exists daily_new_words int not null default 15;
