# Handoff: Padel "add game to phone calendar" feature — shipped + live-iterated

## Session Metadata
- Created: 2026-07-01 12:14
- Project: /Users/admin/Documents/dev/padel-reservas
- Branch: main (feature branch feat/calendar-event was merged in and is no longer needed)
- Deployed live + pushed to origin/main during the session.

### Recent Commits (newest first)
- 07ceef0 feat(calendar): explainer modal before add (dont-show-again); fix slots error-on-add
- 7cd25a9 fix(calendar): replace misleading 'added' toast with a 'pick a calendar' hint (later superseded)
- 0bc347f fix(calendar): deliver .ics via /ics attachment endpoint; keep My-bookings list on refresh error
- ae5f033 fix(calendar): drop slot code from calendar event description
- 884afd3 Merge feat/calendar-event: add padel game to phone calendar
- (+ 10 feature commits 6c77dbc…21c2375, and spec/plan f195ca8/87a62a3)

## Handoff Chain
- **Continues from**: None (new feature). Related prior handoff (different task, same repo):
  `.claude/handoffs/2026-06-30-172202-izar4-reservas-stats-and-api-recon.md` (stats pull + API recon).
- **Supersedes**: None.

## Current State Summary

The "add my padel booking to the phone calendar" feature is **built, tested, merged to main,
deployed live, and pushed to origin/main**. It was then iterated three times against the user's
real iPhone. Everything compiles (`tsc` clean), 84/84 Vitest tests pass, `npm run build` is clean,
and the Worker is deployed (latest version `839c0a92`). The last user-facing state: tapping 📅 on a
slot or a My-bookings row opens an **explainer modal** ("the OS will ask you to pick a calendar; it
won't add by itself" + a "don't show again" checkbox + Continue), then hands an `.ics` to the OS via
a Worker `/ics` attachment endpoint. No known open bugs. The only thing that CANNOT be changed is the
OS's own "choose calendar / Add" confirmation (see Important Context).

## Architecture Overview

- App = **PWA (Vite+React+TS) + one Cloudflare Worker** (`izar4-padel`). Reservations live in
  **izar4.es** (public WordPress REST). The Worker proxies izar4, keeps a KV snapshot, runs push
  cron, and serves the built PWA. Live URL: https://izar4-padel.dimabinskyi.workers.dev
- **Calendar feature data flow:** user taps 📅 → (explainer modal unless dismissed) → `buildBookingEvent()`
  makes a `CalEvent` → `addBookingToCalendar()` (confirm-if-duplicate → `downloadIcs()`) → `downloadIcs`
  builds `/ics?…` query and clicks a plain `<a>` → the **Worker `/ics` route** returns the `.ics` as a
  `text/calendar` **attachment** → OS hands it to Calendar **without navigating the PWA away**.
- **Why the /ics endpoint exists:** the original client-side `window.location.assign(blob:)` for iOS
  *navigated the standalone PWA away to the blob*, tearing down the running app — that caused the
  "My bookings errors and disappears" bug. An attachment download does not navigate the page.

## Critical Files

| File | Purpose |
|------|---------|
| `src/lib/ics.ts` | Pure `buildIcs` (RFC-5545, `VALARM TRIGGER:-PT15M`, DTSTAMP, floating local time) + `buildBookingEvent` + `downloadIcs` (now hits `/ics`, no blob). Tested by `ics.test.ts`. |
| `src/lib/calendarEvents.ts` | localStorage: per-booking "event created" flags (`mark/has/clear/prune`) + the `isCalendarHintDismissed`/`dismissCalendarHint` modal pref. Tested by `calendarEvents.test.ts`. |
| `src/lib/calendar.ts` | `addBookingToCalendar(ev, key, confirmDuplicate)` orchestration. |
| `src/components/CalendarAddModal.tsx` | The explainer modal (checkbox "don't show again" + Continue). |
| `src/components/Toast.tsx` | Shared `useToast` + `<Toast>` (used for error + cancel-reminder toasts). |
| `src/screens/SlotsScreen.tsx` | 📅 wiring: `requestAddToCalendar`→modal→`doAddToCalendar`; cancel reminder; `loadedRef` resilience. |
| `src/screens/MyBookingsScreen.tsx` | Same 📅 wiring + `loadedRef` resilience (keeps list on refresh error). |
| `worker/index.ts` | Public `GET /ics` route (imports `buildIcs` from `../src/lib/ics`), returns `text/calendar` attachment. |
| `src/i18n/locales/{uk,en,ru,es}.json` | `calendar.*` keys: add, alreadyAddedConfirm, error, cancelReminder, eventTitle, eventLocation, hintTitle, hintBody, hintDontShow, hintContinue. |
| `docs/superpowers/specs/2026-06-30-calendar-event-design.md` | Approved design spec. |
| `docs/superpowers/plans/2026-06-30-calendar-event.md` | Implementation plan (10 tasks). |

## Key Patterns Discovered

- **Background-refresh resilience:** both screens now use a `loadedRef` — after the first successful
  load, a failed focus/visibility refresh keeps the last good list instead of blanking it and showing
  an error. Any new screen doing focus-refresh should copy this or it will flash "failed to load".
- **iOS `.ics` delivery:** serve as a same-origin `text/calendar` **attachment** and trigger via a
  plain `<a>` click (NOT `window.location`/blob) so the standalone PWA is not torn down.
- **Deploy build injects `.env` via Node** (`/tmp/padel-build.cjs`): reads `.env` and runs `npm run
  build` with those vars in `process.env`, avoiding shell mangling of `VITE_DEVICE_SECRET` (has
  `* & $ %`). Vite in this repo does NOT auto-read `.env`.

## Work Completed

### Tasks Finished
- [x] Full feature via subagent-driven TDD (10 tasks): ics builder, flag store, orchestration, Toast,
      i18n, SlotRow button, both screens, TTL prune, verification. Merged to main.
- [x] Deployed live + pushed to origin/main; smoke-tested (`/`=200, authed `/api/reservas`=200,
      unauth=401, `/ics`=200 text/calendar attachment with valid VEVENT + 15-min alarm).
- [x] Live iteration on the user's iPhone:
  - Removed slot code (`P1-9`) from the event description.
  - Fixed "My bookings errors + disappears on add" → `/ics` attachment endpoint + `loadedRef`.
  - Replaced the invisible toast with the `CalendarAddModal` explainer.
  - Fixed "failed to load slots on add" → `loadedRef` resilience on SlotsScreen too.

### Files Modified
See Critical Files — all committed and pushed. Working tree clean except one untracked prior handoff.

### Decisions Made
| Decision | Rationale |
|----------|-----------|
| Serve `.ics` from Worker `/ics` attachment vs client blob | Blob navigation tore down the iOS standalone PWA (data loss). Attachment download doesn't navigate. |
| Explainer modal instead of toast | The post-tap toast is hidden behind the OS's own add sheet on iOS, so the user never saw the hint. |
| Cannot bypass OS "choose calendar / Add" | No web API to write the calendar silently; only a native app (Apple Developer $99/yr) could — the user refuses that. |

## Important Context

- **The OS "choose a calendar + Add" confirmation is UNAVOIDABLE from a PWA.** The user asked twice to
  skip it — it is impossible without a native app + calendar permission (Apple Developer Program,
  which the user won't pay for). We mitigate with (a) the explainer modal and (b) advice to set a
  Default Calendar in iOS Settings. If the user wants zero per-event taps, the only path is a **webcal
  subscription feed** (offered, not built) — caveat: OS sync is not instant and subscription alarms
  are unreliable. This is the most likely next request.
- **This is a live, community-facing system** (izar4.es is a real neighbours' booking site the user
  does not own). Never leave test bookings; the "add to calendar" feature only reads the user's own
  booking data they already entered.
- After every deploy, **the installed PWA serves the OLD bundle on first open** (autoUpdate SW) — the
  user must relaunch / clear the SW to see changes. Always remind them.

## Assumptions Made
- Device timezone = Europe/Madrid, so `.ics` uses floating local time (no TZID). Correct for this community.
- `.env` in the repo holds the correct prod `VITE_VAPID_PUBLIC` / `VITE_DEVICE_SECRET` (verified: authed `/api` returns 200 after a build that injects them).

## Potential Gotchas
- **`python` is not on PATH — use `python3`.** The handoff `create_handoff.py` writes to its own skill
  dir (`~/.agents/skills/...`), NOT the project; move the file into the project `.claude/handoffs/` by hand.
- The handoff **validator only recognizes `#`/`##` headings** — keep required sections at `##`.
- Worker deploy prints a `nodejs_compat` warning — it's from the pre-existing web-push lib, not this
  feature; the Worker is healthy (verified 200s).
- Git commits are authored as "Dima Binskyi" (local git config), which is expected.

## Environment State
- **Tools:** `git` (SSH to `git@github.com:DimaBinskyi/izar4-padel-reservation.git`), `wrangler`
  (authenticated), `node`/`npm`. Build helper at `/tmp/padel-build.cjs` (recreate if gone — see Key Patterns).
- **Active processes:** none.
- **Env var NAMES only (never values):** `VITE_VAPID_PUBLIC`, `VITE_DEVICE_SECRET`, `VITE_WORKER_BASE`
  in `.env`; Worker secrets `DEVICE_SECRET`, `VAPID_PRIVATE`. No secret values are in this document.

## Immediate Next Steps
1. **Confirm on the user's iPhone** that the latest deploy (version `839c0a92`) behaves: 📅 → modal →
   Continue → OS add sheet; slots don't error/disappear; My-bookings list stays. (User must relaunch
   the PWA / clear SW first.)
2. If the user still wants "no per-event confirmation", scope the **webcal subscription** alternative
   (a Worker `/calendar.ics` feed of their upcoming bookings + a "Subscribe" button) — brainstorm
   first; warn about sync-delay and unreliable subscription alarms.
3. Optional polish: on iOS with a single calendar the modal's Continue → Add is basically one tap;
   consider a one-line note in the modal about setting a Default Calendar.

## Related Resources
- Spec: `docs/superpowers/specs/2026-06-30-calendar-event-design.md`
- Plan: `docs/superpowers/plans/2026-06-30-calendar-event.md`
- Live app: https://izar4-padel.dimabinskyi.workers.dev  (Worker `izar4-padel`, latest version `839c0a92`)
- izar4 API reference: `docs/API.md`; repo conventions: `CLAUDE.md`

---
**Security note:** contains NO secret values, cancel codes, or personal data — only var/field names and aggregate state.
