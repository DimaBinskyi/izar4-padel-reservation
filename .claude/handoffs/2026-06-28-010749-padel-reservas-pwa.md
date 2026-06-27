# Handoff: Padel reservations PWA (izar4) — built, deployed, iterating on UX

## Session Metadata
- Created: 2026-06-28 01:07:49
- Project: /Users/admin/Documents/dev/padel-reservas
- Branch: main
- Session duration: extended multi-phase session (design → full build → deploy → several UX iterations)

### Recent Commits (for context)
  - dd72c1c fix(carousel): track drag offset in a ref so swipe commits reliably (state was stale in the end handler)
  - 677c5ce feat: animated 3-page slot carousel (drag/swipe between days)
  - e8a7d60 Merge: swipe to change day
  - 933b302 feat: swipe left/right on the slot list to change day (clamped today…+1mo)
  - 20f2555 Merge: UX batch 2 (stats fixes, my-bookings jump-and-blink, settings cleanup)

## Handoff Chain

- **Continues from**: None (fresh start)
- **Supersedes**: None

## Current State Summary

A free, install-anywhere **PWA** to manage **padel** court reservations on **izar4.es**, with
real Web Push + auto-grab. All three planned phases are **built, merged to `main`, deployed, and
verified live** at https://izar4-padel.dimabinskyi.workers.dev. 58 Vitest tests pass; `npm run
build` produces a valid PWA. The last several turns were UX polish on real-device feedback (no-zoom,
safe-area, loading spinners, stats fixes, My-bookings→Slots jump+blink, and an animated swipe
**carousel** for changing days). Everything requested so far is done and deployed. Chat is in
Russian; code/docs in English.

## Codebase Understanding

### Architecture Overview

`PWA (Vite + React + TS + service worker)` ⇄ **one Cloudflare Worker** (`izar4-padel`) ⇄ `izar4
WP REST API`, plus **Web Push (VAPID)** to the device. The Worker: (1) proxies `/api/*` → izar4
(adds CORS, retries 503, KV-caches static endpoints); (2) serves reservations from a cron-maintained
KV **snapshot** via `/api/reservas` (fast); (3) stores push subs/profile/watchlist/prefs in KV;
(4) runs a **Cron** (every min; acts 2-min day / 10-min night) that polls izar4, diffs, auto-grabs
watched freed slots, and sends Web Push. The Worker also serves the built PWA (Static Assets).
Personal data also lives on-device (localStorage + IndexedDB).

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `docs/API.md` | Reverse-engineered izar4 API + verified gotchas | Read before touching data layer |
| `docs/superpowers/specs/2026-06-27-padel-reservas-design.md` | Authoritative design + all decisions | Source of truth |
| `docs/superpowers/plans/2026-06-27-phase{1,2a,2b,3}-*.md` | Implementation plans (TDD) | History/reference |
| `CLAUDE.md` | Repo conventions + gotchas | Read first; **pending additions, see Pending** |
| `worker/index.ts` | Proxy + `/api/reservas`/`/subscribe`/`/vapid`/`/pull-grabbed` + `scheduled` cron | Core backend |
| `worker/logic.ts` (+`.test.ts`) | Pure cron logic (diff/grab/limits/expiry) | TDD'd |
| `worker/push.ts`, `worker/pushText.ts` | Web Push send + localized push text | |
| `src/screens/SlotsScreen.tsx` | Home: carousel of days, book/cancel/watch, profile gate | Biggest component |
| `src/lib/izar4Client.ts` | API client (session-caches static; reservations via `/api/reservas`) | |
| `src/lib/overrides.ts` | Optimistic self-write overrides (read-after-write fix) | |
| `src/lib/{profile,limits,mine,bookingsDb,cancelPolicy,stats,watchlist,notifPrefs,push,recentActions}.ts` | Domain logic (mostly TDD'd) | |

### Key Patterns Discovered

- **i18n is mandatory** — every UI string via `i18next` keys in `src/i18n/locales/{uk,en,ru,es}.json` (uk default). izar4 data shown verbatim.
- **Read-after-write** is handled by `src/lib/overrides.ts` (optimistic add/remove that self-heals once the fetched data agrees) — applied in `SlotsScreen.load` and `MyBookingsScreen.load`.
- **Static data** (franjas/blocks/inmuebles) is session-cached client-side AND KV-cached in the Worker; reservations come from the KV snapshot. Loads are **sequential** (izar4 WAF 503s on bursts).
- **Touch/drag** handlers read offset from a `useRef` (React state is stale within one synchronous gesture).
- Branch-per-change → `tsc --noEmit` + `npx vitest run` + `npm run build` → `wrangler deploy` → verify live → commit → `merge --no-ff`. (A few late fixes were committed directly to `main`.)

## Work Completed

### Tasks Finished

- [x] Reverse-engineered + documented the full izar4 API (`docs/API.md`), verified with create+cancel tests
- [x] Brainstormed + grilled the design; wrote spec + 4 phase plans
- [x] Built Phase 1 (foundation+slots), 2a (profile/booking/cancel), 2b (my-bookings/stats/install/nav), 3 (push+auto-grab) — subagent-driven with reviews
- [x] Deployed to Cloudflare (Worker + KV + cron + VAPID); verified end-to-end live
- [x] Fixed izar4 WAF concurrency throttle (sequential load + worker retry + KV snapshot + cache-path bug)
- [x] UX: no-zoom, safe-area, loading spinners, stats favourite-slot-as-time + future≠played, removed Settings install row, My-bookings tap→Slots jump+scroll+blink, padel app icon, iOS install meta tags
- [x] Animated swipe **carousel** for changing days (verified)

### Files Modified

| File | Changes | Rationale |
|------|---------|-----------|
| (entire project) | created across the session, all on `main` | Greenfield build |

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| PWA, not React Native | RN(+$99 Apple), PWA | Only a home-screen PWA gets **free** iOS web push (no Apple Developer) |
| One free Cloudflare Worker | local-only / GitHub Actions / Cloudflare | Worker+KV+Cron+Assets in one free place; sends web push |
| Reservations from cron KV snapshot | direct izar4 each load | izar4 list is 0.5–6s + WAF-throttled; snapshot ~80ms |
| Client overrides for read-after-write | rely on izar4/KV | both are eventually-consistent → counter was stale after cancel |
| 21-day booking horizon | izar4's 7-day UI limit | server doesn't enforce it (verified); user wanted 21 |

## Pending Work

## Immediate Next Steps

1. **Apply the proposed `CLAUDE.md` additions** — the `/revise-claude-md` step proposed concise additions (Cloudflare/deploy gotchas, PWA/iOS gotchas, izar4 WAF/snapshot notes, verify-live, drag-ref). They were **shown but NOT yet applied** (user switched to handoff). Re-show and apply on approval. Do NOT put the literal `DEVICE_SECRET` in git.
2. **Real-device validation of push + auto-grab** (needs the user's installed iPhone + an actual cancellation event): enable notifications, create a watch, confirm a push arrives on a freed slot and that the Worker auto-grabs. Inspect with `npx wrangler tail izar4-padel`.
3. **User action: refresh the app icon** — iOS cached the old icon at install; user must delete the home-screen app and re-add via Safari.

### Blockers/Open Questions

- [ ] Push delivery + cron auto-grab can only be confirmed on a real installed iOS device with a real freed slot — not simulable here.

### Deferred Items

- Recurring watch patterns; Club social resource; custom domain; multi-device profile sync; notification action buttons (unreliable on iOS web push). (See spec §17.)

## Context for Resuming Agent

## Important Context

- **Deploy correctly or the app breaks:** `wrangler deploy` does NOT build. Always: `VITE_VAPID_PUBLIC=<pub> VITE_DEVICE_SECRET=<same as Worker DEVICE_SECRET> npm run build && npm run worker:deploy`. The client bakes those at build; `VITE_DEVICE_SECRET` MUST equal the Worker `DEVICE_SECRET` secret or every `/api` call 401s and push breaks. The values used this session are in the local (gitignored) `.dev.vars`/deploy notes and the Worker secrets — ask the user if not present; do not hardcode in git.
- **Verify against the live URL** with the Playwright MCP browser (unit tests don't cover the runtime). After every deploy, **clear the service worker + caches** in the browser before checking (autoUpdate serves the OLD bundle on the first load). Hit `/api/*` from the shell with `curl -H "x-device-secret: <DEVICE_SECRET>"`.
- **KV is eventually-consistent** — never rely on read-after-write; that's why `overrides.ts` exists.
- A brand-new `*.workers.dev` cert takes minutes (`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`) — not a bug. (Already provisioned now.)

### Assumptions Made

- izar4 currently has ≤100 padel reservations (single page); the Worker paginates (5×100) so >100 is handled.
- User's iPhone is iOS 16.4+ (required for PWA web push).
- The single shared `DEVICE_SECRET` model is fine (personal use).

### Potential Gotchas

- **Live izar4 write tests MUST create-then-cancel and verify cleanup** (name like `API TEST (auto)`, code `APITEST_DELETEME`). Never leave test bookings in the community's prod system.
- Worker proxy cacheable-path matches `/wp-json/wp/v2/...` (NOT `/wp/v2/...`) — a past bug silently disabled caching.
- `tsc --noEmit` (not `tsc -b`); `noUnusedLocals`/`noUnusedParameters` are on (watch for unused imports = TS6133).
- Module-level client caches broke a unit test → `resetClientCaches()` is called in `izar4Client.test.ts` beforeEach.

### Environment State

#### Tools/Services Used

- Cloudflare: Worker `izar4-padel`, KV namespace `id c753a6d720184a749099ca5c43dda2e4`, Cron `* * * * *`, account subdomain `dimabinskyi.workers.dev`. `wrangler` is **logged in** (this machine).
- Playwright MCP browser (used against the live URL).
- Node 24 / npm 11 / wrangler 3.114.

#### Active Processes

- None persistent. (The brainstorming visual-companion server, if any, auto-exits; not needed.)

#### Environment Variables (NAMES only — no values)

- Build-time (client): `VITE_VAPID_PUBLIC`, `VITE_DEVICE_SECRET`, optional `VITE_WORKER_BASE`. (`.env.example` documents them; real `.env`/`.dev.vars` are gitignored.)
- Worker secrets: `DEVICE_SECRET`, `VAPID_PRIVATE`. Worker vars: `VAPID_PUBLIC`, `VAPID_SUBJECT`. KV binding: `KV`.

## Related Resources

- Live app: https://izar4-padel.dimabinskyi.workers.dev
- Docs: `docs/API.md`, `docs/superpowers/specs/`, `docs/superpowers/plans/`, `CLAUDE.md`, `README.md`
- Memory: `padel-reservas-project`, `izar4-free-no-apple-developer` (in user auto-memory)
- Logs: `npx wrangler tail izar4-padel`
