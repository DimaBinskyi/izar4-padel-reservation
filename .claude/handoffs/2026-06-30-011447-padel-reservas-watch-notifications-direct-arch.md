# Handoff: izar4 padel PWA — watches, push notifications & direct-from-client architecture

## Session Metadata
- Created: 2026-06-30 01:14:47
- Project: /Users/admin/Documents/dev/padel-reservas
- Branch: main (clean, pushed to origin)
- Remote: git@github.com:DimaBinskyi/izar4-padel-reservation.git
- HEAD: 0583022
- Session duration: long, multi-feature (context compacted once)

### Recent Commits (for context)
- `0583022` feat(watch): refuse to create a watch if the selected range has any free slot (warn only)
- `2ab48ee` feat(watch): only watch occupied slots — warn (toast) about free ones; "already" is a warning too
- `e926505` feat(watch): delete a watch via the info modal (info + confirm), no instant trash
- `a4d6a27` feat(watch): allow several watches per day; merge only contiguous ranges
- `a7a76c7` feat(watch): merge overlapping watches with a toast; "waiting for limit" badge; date-format dates
- `6556e0f` fix(watch): don't deactivate a watch on the weekly limit — keep it standing
- `264bc43` fix(watch): auto-clear expired watches; propagate cleared watchlist to the worker
- `2f1617e` fix: per-install device id (multi-user safe) + clear watch after auto-grab

## Handoff Chain
- **Continues from**: None (fresh start — first handoff file, but session continues prior compacted work)
- **Supersedes**: None

## Current State Summary

All requested work is **complete, built, deployed, committed, and pushed**. The last task was the
watch (ловля) "occupied-only" rule: when a user picks a from–to range in the WatchSheet, if that range
contains ANY free slot the app shows an amber ⚠️ warning toast (`watch.toastHasFree`) and does NOT create
the watch — the user must narrow the selection to only-occupied slots. Toast colors are finalized: amber =
warning, green = info (a brief blue variant was tried then reverted on user request). 68 tests pass.
Deployed bundle is `index-C6_1KHib.js`. Nothing is outstanding; awaiting the user's next instruction.

## Codebase Understanding

### Architecture Overview

A PWA (Vite + React + TypeScript + i18next) served as **Cloudflare Worker Static Assets**, fronted by a
Worker that also handles `/api/*`, a Cron trigger, KV storage, and Web Push (VAPID).

**Direct-from-client architecture (key pivot this session):** reads AND writes go from the browser
**directly** to izar4's WordPress REST API (`izar4.es/wp-json`), using the *user's* IP — which izar4's WAF
does NOT throttle (~0.8s). The Worker's own IP IS throttled by the WAF (6–12s, escalating), so the Worker
is only a **fallback proxy** plus the home of: the Cron poller, the KV snapshot, Web Push notifications,
and a `/api/snapshot` endpoint the client POSTs to keep the snapshot warm. CORS on izar4 is fully open
(reflects origin, allows GET/POST + preflight), which is what makes direct calls possible.

**Snapshot model:** KV holds a reservations snapshot maintained by (a) cron poll, (b) client feeding via
`POST /api/snapshot`, and (c) write-patching on reservar/cancelar. `x-snapshot-ts` response header carries
the snapshot timestamp so the UI can show "cached · <time>".

**Watches (ловля):** localStorage list of per-date slot ranges the cron poller tries to auto-grab when a
slot frees up. Multiple disjoint watches per day allowed (morning vs evening = separate); contiguous
ranges merge. Standing (weekly-limit-blocked) watches stay active; expired (past-date) watches self-prune.

### Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/lib/izar4Client.ts` | Direct-first izar4 reads/writes + worker fallback; snapshot push; localStorage static cache | HIGH |
| `src/lib/watchlist.ts` | Watch type + `addOrMergeWatch` (contiguity merge), prune, remove-by-id/slot | HIGH |
| `src/components/WatchSheet.tsx` | Watch UI: create/merge/refuse-if-free, info+confirm delete modal, toasts | HIGH |
| `worker/index.ts` | `fetch`+`scheduled`; runPoll auto-grab; snapshot patch/refresh; push; `/api/*` | HIGH |
| `worker/pushText.ts` | Push body text + `fmtDate` (DD.MM.YYYY) | MED |
| `src/screens/SlotsScreen.tsx` | Instant-snapshot + background-live; pull-to-refresh; freshness pill; wires WatchSheet | HIGH |
| `src/lib/deviceSecret.ts` | `getDeviceId()` per-install UUID + `getDeviceSecret()` baked shared auth | MED |
| `src/lib/syncGrabbed.ts` | Pulls auto-grabbed bookings; clears the watch that grabbed | MED |
| `src/lib/dates.ts` | `ymdToDisplay` → DD.MM.YYYY | LOW |
| `src/i18n/locales/{ru,en,es,uk}.json` | All UI strings (uk default) — NO hardcoded strings allowed | MED |

### Key Patterns Discovered

- **No hardcoded UI strings** — everything via i18next; uk is default, plus en/ru/es. Locale JSON is
  pretty-printed multi-line.
- **Cloudflare Workers do NOT support `RequestInit.cache`** — passing `{cache:'no-store'}` THROWS
  ("not implemented"). This crashed the cron once (see gotchas). Use the `izar4Fetch` helper instead.
- **No optimistic UI** — user explicitly rejected optimistic modal close ("не закрывай оптимистически").
  Speed comes from instant-snapshot + background refresh, never from faking success.
- **Minimize izar4 requests** — user dislikes spamming them; cron is every 2 min (day) / every 10 min
  (night). Static data (e.g. `bloqueos-fecha`) is cached in localStorage.
- **Toast colors**: amber `#241a00/#4a3a12/#f2c14e` = warning (with ⚠️); green `#0e2018/#234e34/#a7e8c1`
  = info. Do not change without explicit ask.
- **Dates shown to users**: DD.MM.YYYY via `ymdToDisplay` / `fmtDate`, never raw `YYYYMMDD`.

## Work Completed

### Tasks Finished

- [x] Empty-slots bug — worker no longer overwrites snapshot with a failed/empty izar4 fetch
- [x] 401-after-redeploy — root cause: `VITE_DEVICE_SECRET` not baked (Vite ignores `.env` here)
- [x] Booking modal weekly count uses the booking's week, shown as "remaining after booking"
- [x] Direct-from-client reads + writes; worker proxy fallback; client feeds `/api/snapshot`
- [x] Pull-to-refresh (no top spinner; page "refreshing" text only); always-on freshness pill w/ timestamp
- [x] localStorage cache for static `bloqueos-fecha` (was 1.65s)
- [x] **Cron crash fixed** (`{cache:'no-store'}` removed) — this had silently broken ALL push notifications
- [x] Duplicate push fixed (freed-for-own skip + endpoint dedup; per-install device id)
- [x] Watch lifecycle: self-clear on grab/expiry; standing on weekly-limit; "⏳ waiting for limit" badge
- [x] Watch merge (contiguous) / disjoint same-day kept separate; "already" detection
- [x] Watch info+confirm delete modal (no instant 🗑)
- [x] Watch refuses creation if selection has ANY free slot (amber warn); "already in watch" warns too

### Files Modified

Many across the session (see Critical Files + git log). Working tree is currently **clean** — all changes
are committed and pushed to `origin/main` at `0583022`.

### Decisions Made

| Decision | Options Considered | Rationale |
|----------|-------------------|-----------|
| Direct client→izar4 for reads+writes | worker-proxy everything | Worker IP WAF-throttled 6–12s; user IP ~0.8s |
| Keep worker proxy as fallback | remove it | Resilience if CORS/direct ever fails |
| Cron every 2 min (day) | live-on-read | User: "не хочу спамить" izar4 |
| No optimistic UI | optimistic close | User explicitly rejected it |
| Refuse watch if any free slot | filter to occupied only | User's final call: user must pick busy-only range |
| Per-install device UUID + shared auth secret | single shared id | Multi-user/duplicate-push safety |

## Pending Work

## Immediate Next Steps

1. **None** — wait for the user's next instruction.
2. If the user tests now: remind them to **reload the PWA** so autoUpdate fetches bundle `C6_1KHib`
   (first load after deploy serves the previous bundle).
3. Verify watch behavior: range with a free slot → ⚠️ amber, no watch created; range of only-occupied
   slots → created (green toast).

### Blockers/Open Questions

- [ ] None open.

### Deferred Items

- None.

## Context for Resuming Agent

## Important Context

- **Build & deploy is manual and secret-sensitive.** Vite does NOT auto-read `.env` in this environment,
  and `DEVICE_SECRET` contains shell-special characters. You MUST export the baked vars inline before
  building, e.g. `export VITE_DEVICE_SECRET="$(...)"` (quote it!) then build, then `wrangler deploy`.
  After deploy, sanity-check: the secret appears exactly once in the bundle (grep count 1) and
  `/api/vapid` returns 200. NEVER commit the secret; the README once contained it literally and it was
  removed before any push.
- **The cron silently broke push once** via `{cache:'no-store'}`. If notifications stop, check
  `wrangler tail` for a thrown exception in `scheduled`/`runPoll` FIRST.
- **Watches are localStorage-only on the client**, mirrored to the worker on sync. The worker poller is
  what actually auto-grabs. Clearing a watch locally propagates on next sync.

### Assumptions Made

- izar4 CORS stays open (user confirmed it works from the browser).
- Only a handful of devices/users; dedup by subscription endpoint is sufficient.

### Potential Gotchas

- `RequestInit.cache` is unsupported in Workers — use `izar4Fetch`, never `{cache:'no-store'}` server-side.
- Dates everywhere are `YYYYMMDD` strings internally; convert with `ymdToDisplay`/`fmtDate` for display.
- autoUpdate service worker serves the OLD bundle on the first post-deploy load — always reload twice / tell the user.
- KV snapshot can be poisoned by `POST /api/snapshot []`; the endpoint guards empty arrays — keep that guard.

### Environment State

#### Tools/Services Used
- Cloudflare Worker (Static Assets + `/api/*` + Cron + KV + Web Push/VAPID)
- `wrangler deploy`, `wrangler tail` (cron logs), `wrangler kv key list/delete --namespace-id=c753a6d720184a749099ca5c43dda2e4`
- Playwright MCP for live in-browser verification
- Vitest (68 tests)

#### Active Processes
- None running.

#### Environment Variables (names only — NEVER values)
- `VITE_DEVICE_SECRET` (baked into bundle at build; shared auth)
- `VITE_VAPID_PUBLIC` (baked)
- Worker-side: `DEVICE_SECRET`, VAPID keypair, KV binding — set as Cloudflare secrets/bindings

## Related Resources
- Repo: git@github.com:DimaBinskyi/izar4-padel-reservation.git (branch `main`)
- izar4 API base: `https://izar4.es/wp-json`
- Memory: `padel-reservas-project.md`, `padel-deploy-gotchas.md`, `izar4-free-no-apple-developer.md`, `comms-language.md`

---

**Security Reminder**: No secret values are included above (names only). Validated before finalizing.
