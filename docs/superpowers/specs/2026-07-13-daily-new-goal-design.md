# Daily new-word goal — design

**Date:** 2026-07-13
**Status:** approved

Let the learner choose how many new words a day the guided session introduces,
replacing the hardcoded `NEW_PER_DAY = 15`.

## Why

The per-day new-word budget is a constant in `src/lib/dailyNew.js`. It has already
been moved once by hand (7 → 15, commit `0ea1481`) because different learners —
and the same learner at different points before an exam — want different intake.
Pacing is a learner decision, not a build-time one.

## Data

Migration `supabase/migrations/0009_daily_new_goal.sql`:

```sql
alter table profiles
  add column daily_new_words int not null default 15;
```

Default 15 preserves current behaviour exactly for existing rows: nobody's pacing
changes until they touch the stepper.

Stored on `profiles` (not localStorage) so the goal follows the user across
devices and survives a cache clear — the same treatment `active_target_language`
and `interface_language` already get.

## Logic

`dailyNew.js` stops owning the number.

- `NEW_PER_DAY = 15` → `DEFAULT_NEW_PER_DAY = 15`, used only as the fallback while
  a profile hasn't loaded yet.
- The budget functions take the limit as an argument instead of closing over a
  module constant:

  ```js
  remainingNewToday(todayISO, limit)   // was: remainingNewToday(todayISO)
  ```

The **counter** (how many new words were introduced today) stays in localStorage,
device-local and self-resetting — unchanged. Only the **budget** moves to the
profile. Keeping the counter local and passing the limit in leaves these functions
pure and testable without a database.

## Consumers

Both existing callers pass `profile.daily_new_words ?? DEFAULT_NEW_PER_DAY`:

| Site | Use |
|---|---|
| `Dashboard.jsx:245` | the "learn N new?" CTA offer |
| `SessionV2.jsx:341` | the planner's `newPerDay` |

These two must agree, or the CTA offers a session the planner then refuses — the
hazard `dailyNew.js:13` already warns about. Feeding both from one profile value
is what keeps them consistent.

## UI

A stepper row in the profile dropdown (`Dashboard.jsx`), above Sign out:

```
┌─ Profile ───────────────┐
│ Name: [ Nika        ]   │
│ [ Save ]  [ Cancel ]    │
│─────────────────────────│
│ New words per day       │
│   [ − ]  15  [ + ]      │
│─────────────────────────│
│ Sign out →              │
│ Delete account          │
└─────────────────────────┘
```

- Range 5–30, step 5 (5 · 10 · 15 · 20 · 25 · 30). Coarse enough that every notch
  is a real pacing decision; a floor of 5 keeps a session worth starting.
- Persists via the existing `updateProfile` from `AuthContext`, exactly as the
  name field does. Optimistic local state.
- EN/UK labels, consistent with the rest of that menu.

The profile dropdown is already the de-facto settings home, so this adds no new
surface and no layout redesign — consistent with deferring design polish until
branding is settled.

## Edge case: lowering the goal mid-day

Lowering the goal below the number already learned today → `remainingNewToday`
clamps to 0 via its existing `Math.max`. No further new words are offered that
day; the counter itself is not rewritten. This is the sane reading of "I want
fewer new words today."

## Testing

`src/lib/dailyNew.test.js` currently **fails**: it was written when the cap was 7
and was never updated when the cap became 15, so it asserts the budget is spent
after 7 words. Parameterising the limit fixes it at the root — the tests become
limit-explicit rather than leaning on a global that keeps moving.

New/updated coverage in `dailyNew.test.js`:

- `remainingNewToday(today, 10)` returns the full 10 when nothing is learned yet.
- The budget shrinks as words are introduced and clamps at 0, at an explicit limit.
- A new date resets the budget, at an explicit limit.
- A limit lowered below today's count yields 0 remaining, never negative.
- `DEFAULT_NEW_PER_DAY` is used when no limit is supplied (profile not yet loaded).

## Out of scope

- Asking for the goal during onboarding (can follow later; the profile default
  covers new users).
- A separate cap on *reviews* per day. Only new-word intake is configurable here.
