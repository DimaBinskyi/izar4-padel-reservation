# CLAUDE.md — Padel Reservas

Guidance for working in this repo. Read the two source docs before changing behavior:
- **Design spec:** `docs/superpowers/specs/2026-06-27-padel-reservas-design.md` (authoritative)
- **izar4 API reference:** `docs/API.md`

## What this is
A free, installable **PWA** to manage **padel** reservations on **izar4.es**, with **closed-app
web push** when a slot frees up and optional **auto-grab** of freed slots. No app store, no Apple
Developer account, no paid server/domain.

**Why a PWA, not React Native:** iOS Web Push works on a home-screen PWA from iOS 16.4 with no
Apple Developer Program ($99/yr) — the only free way to get closed-app push on iPhone. The user
won't pay Apple and won't run a real backend, so the only always-on piece is **one free
Cloudflare Worker**.

## Architecture
`PWA (React + service worker)` ⇄ `1 Cloudflare Worker` ⇄ `izar4 WP REST API`, plus **Web Push
(VAPID)** straight to the device. The Worker: proxies izar4 (CORS), stores push
subscriptions/profile/watchlist/prefs in **KV**, and runs a **Cron** poll → diff → auto-grab →
push. All personal data also lives on-device.

## Repo layout
```
docs/        API.md, design spec (read these first)
src/         PWA — Vite + React + TS + vite-plugin-pwa + i18next   (added during implementation)
worker/      Cloudflare Worker — KV + Cron + Web Push (VAPID)      (added during implementation)
```

## Conventions (do not violate without updating the spec)
- **i18n is mandatory.** No hard-coded UI strings — everything goes through `i18next` keys.
  Locales: **`uk` (default/fallback)**, `en`, `ru`, `es` in `src/i18n/<locale>.json`. izar4 data
  (names, "Pádel", apartment refs) is shown verbatim, never translated.
- **UI labels:** Vivienda → "Apartment / Квартира"; Código → "Cancel code / Код отмены". izar4
  **API field names stay unchanged** (`vivienda_reservas`, `codigo_cancelacion_reservas`, …).
- **Two time windows — never conflate:** booking/watch/grab **horizon = 21 days**; generic
  "slot freed" **notification window = 7 days**.
- **Limits:** 3/week + 1/day, counted **strictly per vivienda**. Fixed, not user-editable. izar4
  does NOT enforce these — **we** do.
- **"Mine":** limit counting by vivienda only; personal list / "my booking cancelled" by
  vivienda + name (soft).
- **Cancellation:** own bookings only. Keep a **per-booking code memory** (the code used at
  creation) so cancel works after the profile code changes. **Never display or harvest other
  users' codes**; for unknown bookings, require the correct code (proof of ownership).
- **Calendar:** month view, min day = today; days beyond the 21-day horizon are view-only.
- **Touch/drag handlers** read the offset from a `useRef` (React state is stale within one synchronous gesture); the carousel drives the track `transform` imperatively (no setState per `touchmove`).

## izar4 gotchas (see docs/API.md §4)
- Call izar4 **only through the Worker proxy** — direct browser calls fail CORS.
- **Read-after-write lag:** after `reservar`, the list may not show the new row immediately. Use
  cache-busting + optimistic UI + reconcile on next poll.
- Server ignores its own rule limits (7-day / 3-week / 1-day) — verified by testing.
- Date formats vary (`YYYYMMDD` vs `dd/mm/yyyy`); weekday codes `D L M X J V S` (Sun=0).
- izar4's WAF **503s on concurrent request bursts** → the client loads sequentially + session-caches static data (franjas/blocks/inmuebles); the Worker proxy retries 503 and KV-caches static GETs.
- Reservations come from the cron-maintained KV **snapshot** via `GET /api/reservas` (~80ms vs 0.5–6s direct); `?live=1` forces a fresh fetch (used right after a write).
- The Worker proxy's cacheable-path check matches the full path `/wp-json/wp/v2/...` (NOT `/wp/v2/...`) — a mismatch silently disables caching.

## Testing rule (IMPORTANT)
Any live test against izar4 that **creates** a reservation MUST **cancel it immediately** and
verify cleanup (scan for leftovers). Use an obvious test name/code. Never leave test bookings in
the community's production system.

## Deploy (all free, one Cloudflare account)
Single Worker (Static Assets) serves the built PWA + `/api/*` + cron; KV namespace for state;
VAPID keypair (public in PWA, private as a Worker secret). Deployed via `wrangler`.

## Commands
- `npm install` — install deps.
- `npm test` — run the Vitest suite (`npx vitest run`).
- `npm run dev` — Vite dev server (proxies `/api` → `http://localhost:8787`).
- `npm run worker:dev` — run the Worker locally (`wrangler dev`, serves `/api`, reads `.dev.vars`).
- `npm run build` — `tsc --noEmit && vite build` → `dist/` (PWA: `manifest.webmanifest` + `sw.js`).
- `npm run worker:deploy` — `wrangler deploy` (needs `wrangler login` + `wrangler secret put DEVICE_SECRET`).
- Local dev auth: set the device secret in the browser to match `.dev.vars`:
  `localStorage.setItem('padel_device_secret','dev-local-secret')`.

## Cloudflare / deploy gotchas
- `wrangler deploy` does NOT build — run `npm run build` first (it uploads `dist/` + the worker).
- The client bakes `VITE_VAPID_PUBLIC` + `VITE_DEVICE_SECRET` at build time; redeploy with both set, and `VITE_DEVICE_SECRET` MUST equal the Worker `DEVICE_SECRET` secret or the PWA gets 401 / no push. Deploy: `VITE_VAPID_PUBLIC=… VITE_DEVICE_SECRET=… npm run build && npm run worker:deploy`.
- A new `*.workers.dev` subdomain needs a one-time interactive registration (user runs `wrangler deploy`) and its TLS cert takes a few min (`ERR_SSL_VERSION_OR_CIPHER_MISMATCH` / curl exit 35 until ready).
- **KV is eventually-consistent** — never rely on read-after-write; the client uses `src/lib/overrides.ts` (optimistic, self-healing) so counter/slots are correct immediately after a book/cancel.
- Live: https://izar4-padel.dimabinskyi.workers.dev (Worker `izar4-padel`).

## PWA / iOS gotchas
- `index.html` must keep `apple-mobile-web-app-capable` + `apple-touch-icon` (else iOS "Add to Home Screen" = Safari shortcut: no standalone, no push).
- iOS caches the home-screen icon at install — changing it requires deleting + re-adding the app.
- Global 16px inputs + viewport `user-scalable=no` stop iOS focus-zoom — keep both.
- vite-plugin-pwa `autoUpdate` serves the OLD bundle on the first load after a deploy — clear the SW (or relaunch) to verify a deploy.

## Verifying changes live
- Verify against the deployed URL with the Playwright MCP browser, not only unit tests. Clear SW+caches between checks (`navigator.serviceWorker.getRegistrations()…unregister()` + `caches.keys()…delete`).
- Hit `/api/*` from the shell: `curl -H "x-device-secret: <DEVICE_SECRET>" …`.
- Simulate gestures by dispatching `TouchEvent` with `new Touch({...})` (touchstart→touchmove→touchend).

## Constraints to respect
Free only (no Apple Developer, no paid host/domain). One small free cloud component is OK — keep
it small. **Support Android too**, not just iOS (different install/permission flow). Surface
hidden costs/limits honestly and up front.
