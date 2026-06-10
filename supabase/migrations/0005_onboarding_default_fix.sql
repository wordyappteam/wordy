-- Fix: change onboarding_complete default to false so new user profile rows
-- (whether created by trigger or manually) trigger the onboarding redirect.
-- Backfill all currently existing profile rows to true — they are already using the app.

alter table public.profiles
  alter column onboarding_complete set default false;

update public.profiles
  set onboarding_complete = true
  where onboarding_complete is null or onboarding_complete = false;
