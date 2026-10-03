# Handoff: Padel — watch icon states (⏸ pause) + overwrite watches (shipped & live)

## Session Metadata
- Created: 2026-07-07 12:27:31
- Project: /Users/admin/Documents/dev/padel-reservas
- Branch: main
- Session duration: continuation session — two features shipped (⏸ pause state, then overwrite watches)

### Recent Commits (for context)
  - 51d24df feat(watch): overwrite watches — grab a freed slot and swap out that day's booking
  - 98270c8 feat(slots): "paused by limit" watch state — ⏸ icon + reason in watch details
  - 0da51aa fix(slots): fixed 52px slot-row height so presence of a button doesn't change it
  - f61a429 feat(slots): show active-watch indicator on caught slots; hide + when limit reached
  - 07ceef0 feat(calendar): explainer modal before add (dont-show-again); fix slots error-on-add

## Handoff Chain

- **Continues from**: [2026-07-06-152621-padel-watch-indicator-slot-ui.md](./2026-07-06-152621-padel-watch-indicator-slot-ui.md)
  - Previous: the green 👁 active-watch indicator + hide "+" when the limit is reached + fixed 52px row height.
- **Supersedes**: None (extends the same watch/slots area).

## Current State Summary

All work is **complete, committed to `main`, pushed, and deployed live** (Worker `izar4-padel`, latest version `d574ebe1-2c6a-4e51-b485-89cae9a992ce`). Two features shipped this session: (1) a **"paused by limit" watch state** — a standing watch that can't fire because the day (1/day) or week (3/week) limit is reached shows a yellow ⏸ on the slot and spells out the reason in the watch details; (2) **overwrite watches** — a watch can be flagged to overwrite that day's existing booking: when it fires, the worker books the freed slot FIRST then cancels the old same-day booking (book-before-cancel), shown with a 🔁 icon. Nothing pending.

## Architecture Overview

Unchanged from the base spec: PWA (Vite + React + TS + i18next) talks to izar4 WP REST API directly; one Cloudflare Worker (`izar4-padel`) serves the built PWA + `/api/*`, holds state in KV, and runs the cron (poll → diff → auto-grab → push). Watches (`padel_watchlist` in localStorage) sync to the Worker via `POST /api/subscribe`; the cron auto-grabs freed slots and the client pulls results via `GET /api/pull-grabbed` (`src/lib/syncGrabbed.ts`).

Key domain fact (verified, see prior api-recon handoff): the **3/week + 1/day limits are client/Worker-enforced only — izar4's backend does NOT enforce them**. Cancellation codes are public in izar4's `/reservas` listing, but we do NOT harvest them; the Worker cancels with the profile code, the client with its saved per-booking code.

## Watch icon state machine (the mental model)

For an occupied, not-mine, not-past slot covered by a watch W, the SlotRow button is:
- **🎯 amber** — not watched (tap → create-watch sheet).
- **👁 green** — active plain watch (will fire).
- **🔁 green** — overwrite watch (armed, or a same-day swap is available). `SlotRow` shows 🔁 when `watchOverwrite && !watchPaused`.
- **⏸ amber** — paused by a limit. Plain watch: paused if day OR week blocked. Overwrite watch: paused ONLY by a *pure weekly* block (`weekBlocked && !dayBlocked`) — the daily block is exactly what the swap resolves.

Priority in `SlotRow`: `watchPaused` → ⏸; else `watchOverwrite` → 🔁; else 👁. `SlotsScreen` computes `dayBlocked`/`weekBlocked` once and derives `paused`/`ow` per covering watch.

## Critical Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/lib/watchlist.ts` | Watch model + localStorage CRUD | `Watch.overwrite`; `addOrMergeWatch(...,overwrite)` OR-merges the flag + upgrades a covered watch; `wouldMergeOverwrite()`; `watchCoveringSlot()` |
| `src/lib/limits.ts` | Limit counting | `limitBlockReason(all,viv,fecha,daily,weekly)` returns 'day' / 'week' / null (day priority) |
| `src/components/SlotRow.tsx` | One slot row | icon state machine (🎯/👁/🔁/⏸) via `watched`/`watchPaused`/`watchOverwrite` |
| `src/screens/SlotsScreen.tsx` | Slots screen | computes `dayBlocked`/`weekBlocked`, per-slot `paused`/`ow`; passes to SlotRow; refreshes watches on sheet close + focus |
| `src/components/WatchSheet.tsx` | Create/list/detail sheet | overwrite checkbox (locked when merging into an overwrite watch), `watchStatus()`, reason badges/messages, merge/upgrade toast |
| `src/lib/syncGrabbed.ts` | Pull grabbed results | reconciles the overwrite swap (markCancelled; fallback cancel with saved per-booking code) |
| `worker/logic.ts` | Pure grab logic (tested) | `Watch.overwrite`; `chooseGrab` gains `ctx.bypassLimits` |
| `worker/index.ts` | Worker: cron + `/api/*` | auto-grab does book-then-cancel for overwrite; `cancelReservation()` helper; grabbed payload carries `overwrite/oldId/oldSlot/oldCancelled` |
| `src/i18n/locales/*.json` | i18n (uk default) | `watch.dayLimit`, `watch.dayLimitInfo`, `watch.overwrite*` (6 keys) |

## Key Patterns Discovered

- The worker `Watch` (in `worker/logic.ts`) is a minimal mirror of the client `Watch`; both got `overwrite?: boolean`. Old KV records without the flag read as falsy → backward compatible.
- Overwrite swap is **limit-neutral**: book new (day+1) then cancel old (day−1) → net 0 on both day and week counts. So `bypassLimits = overwrite && hasSameDayBooking`.
- i18n locale JSON is bundled wholesale — a key string appearing in the built bundle does NOT prove any component uses it.

## Work Completed

### Tasks Finished

- [x] ⏸ "paused by limit" state (day vs week) on the slot + reason in watch details/list
- [x] Overwrite watches end-to-end: model flag, worker book-then-cancel swap, 🔁 icons, checkbox + merge/lock + hints, client reconcile/fallback
- [x] Unit tests: `limitBlockReason`, `chooseGrab(bypassLimits)`, `addOrMergeWatch` OR-merge/upgrade, `wouldMergeOverwrite`
- [x] Committed (98270c8, 51d24df) → main, pushed, built with baked secrets, deployed, verified live

## Files Modified

See the Critical Files table — all of those were edited this session (plus `worker/logic.test.ts`, `src/lib/watchlist.test.ts`, `src/lib/limits.test.ts` for tests). 91 tests pass.

## Decisions Made

| Decision | Options considered | Rationale |
|----------|-------------------|-----------|
| Overwrite = same-day swap only | also cancel a booking on another day when the week is full | User chose "бронь того же дня"; a same-day swap is limit-neutral and unambiguous |
| Worker cancels immediately (client fallback) | client cancels on next app open | User chose "Worker — сразу"; works app-closed; profile code covers the common case, client reconciles rare mismatches |
| 🔁 distinct icon for overwrite | reuse green 👁 | User chose distinct 🔁 |
| ⏸ pause icon covers day AND week | daily only | User chose "день и неделя"; also fixed the prior bug where a weekly-blocked watch lit up green as "active" |

## Pending Work

## Immediate Next Steps

1. Nothing required — both features are live. If iterating, verify against https://izar4-padel.dimabinskyi.workers.dev with the Playwright MCP browser (clear SW + caches first).
2. Optional: a real live functional test of the overwrite auto-swap was NOT run (it needs a genuinely freed slot + a throwaway booking in izar4 prod, which must be cancelled immediately per the repo testing rule). UI + grab logic are covered by types/unit tests.

### Blockers/Open Questions

- [ ] None blocking.

### Deferred Items

- **Overwrite same-cycle edge:** two DISJOINT overwrite watches on the same day both firing in one cron cycle can briefly exceed 1/day (each swaps against the cycle-start snapshot); self-corrects on the next poll. One overwrite watch per day is exact. Documented in commit 51d24df.
- **Free-but-watched slot** (from the prior handoff): a freed slot still covered by a standing watch shows a plain "+"/nothing, no "you're watching this" hint. Left as-is.

## Important Context

Both features are shipped and live — do NOT re-deploy/re-commit unless asked. If you DO deploy, follow the exact dance below; a plain `npm run build` will NOT bake the secrets (Vite ignores `.env` here) and yields a broken (401/no-push) bundle.

Build + deploy (secrets never printed):
1. Inject `.env` into the build env via Node (reads the file literally so shell-special chars in `DEVICE_SECRET` are safe), then `npm run build`:
   ```
   node -e 'const fs=require("fs"),{execSync}=require("child_process");const env={};for(const l of fs.readFileSync(".env","utf8").split(/\r?\n/)){if(!l||l.trim().startsWith("#")||!l.includes("="))continue;const i=l.indexOf("=");let k=l.slice(0,i).trim(),v=l.slice(i+1).trim();if((v.startsWith("\"")&&v.endsWith("\""))||(v.startsWith("\x27")&&v.endsWith("\x27")))v=v.slice(1,-1);env[k]=v;}execSync("npm run build",{stdio:"inherit",env:{...process.env,...env}});'
   ```
2. Verify `VITE_DEVICE_SECRET` baked into `dist/assets/index-*.js` (boolean check; never print the value).
3. `npm run worker:deploy` (wrangler authenticated as Dimabinskyi@gmail.com).
4. Verify live with a cache-bust query: `curl -s "https://.../?cb=<nonce>" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'` shows the new hash.

## Assumptions Made

- The user's same-day booking to overwrite was created by this app with the profile code (so the Worker's profile-code cancel succeeds). Otherwise the client fallback (saved per-booking code) or a manual cancel handles it.
- `VITE_WORKER_BASE` empty in `.env` is intentional (same-origin; Worker serves the PWA).

## Potential Gotchas

- **git broke mid-session on the Xcode license.** `/usr/bin/git` (the only git) is an Xcode shim; a CLT/Xcode update reset license acceptance and every `git` call failed with "You have not agreed to the Xcode license agreements." Fix (user runs, needs sudo password): `sudo xcodebuild -license accept` (or `sudo xcode-select --switch /Library/Developer/CommandLineTools`). wrangler/npm/node are unaffected, so a DEPLOY still works while git is down — commit after the license is fixed.
- **Stale Read cache observed:** the Read tool returned an out-of-date copy of `src/components/WatchSheet.tsx` (pre-⏸ version) even though disk had the current one. Cross-check with `grep`/`git diff`/`sed` when a file's content looks wrong; Edit matches against the real disk file, so edits still apply correctly.
- **Vite ignores `.env`** → must inject `VITE_*` into the build process env (see above).
- **`VAPID_PUBLIC` in `config.ts` is a dead export** — client fetches the key at runtime from `/api/vapid`; its absence from the bundle is correct.
- **Post-deploy edge cache**: Cloudflare serves a stale `index.html` for a few minutes (`cf-cache-status: HIT`, `max-age=0, must-revalidate`); the old asset hash 404s so stale HTML self-heals. Verify with a cache-bust query, not a plain `/`. PWA `autoUpdate` serves the OLD bundle on the first on-device load after deploy — relaunch / clear SW.
- **Testing rule:** any live izar4 test that CREATES a booking must cancel it immediately (prod is a real community system).

## Environment State

### Tools/Services Used
- `wrangler` — authenticated as Dimabinskyi@gmail.com; Worker `izar4-padel`, KV bound. `npx wrangler deploy --dry-run --outdir /tmp/...` type/builds the worker without shipping.
- `git` — remote `origin` = git@github.com:DimaBinskyi/izar4-padel-reservation.git; `main` in sync. (See the Xcode-license gotcha.)
- Vitest (91 tests) + `tsc --noEmit` (root tsconfig includes `src` AND `worker` with `@cloudflare/workers-types`, so it typechecks the worker too) — both green.

### Active Processes
- None running.

### Environment Variables
- Build-time (in `.env`, names only): `VITE_VAPID_PUBLIC`, `VITE_WORKER_BASE` (empty), `VITE_DEVICE_SECRET`.
- Worker secret (mirror in `.dev.vars`, names only): `DEVICE_SECRET` (must equal `VITE_DEVICE_SECRET`). Never print values; `DEVICE_SECRET` has shell-special chars.

## Related Resources

- Live app: https://izar4-padel.dimabinskyi.workers.dev
- `CLAUDE.md` — authoritative conventions + deploy/PWA/Cloudflare gotchas
- `docs/superpowers/specs/2026-06-27-padel-reservas-design.md` — design spec; `docs/API.md` — izar4 API (§2.2 cancel, public codes)
- Prior handoffs: `2026-07-06-152621-padel-watch-indicator-slot-ui.md`, `2026-06-30-172202-izar4-reservas-stats-and-api-recon.md` (limit-enforcement recon)

---

**Security Reminder**: Before finalizing, run `validate_handoff.py` to check for accidental secret exposure.
