-- Onboarding completion flag on user profiles.
-- Default true so existing users with profile rows are not sent back to onboarding.
-- New users have no profile row (profile === null in the app) which also triggers the redirect.

alter table public.profiles
  add column if not exists onboarding_complete boolean default true;
