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

## izar4 gotchas (see docs/API.md §4)
- Call izar4 **only through the Worker proxy** — direct browser calls fail CORS.
- **Read-after-write lag:** after `reservar`, the list may not show the new row immediately. Use
  cache-busting + optimistic UI + reconcile on next poll.
- Server ignores its own rule limits (7-day / 3-week / 1-day) — verified by testing.
- Date formats vary (`YYYYMMDD` vs `dd/mm/yyyy`); weekday codes `D L M X J V S` (Sun=0).

## Testing rule (IMPORTANT)
Any live test against izar4 that **creates** a reservation MUST **cancel it immediately** and
verify cleanup (scan for leftovers). Use an obvious test name/code. Never leave test bookings in
the community's production system.

## Deploy (all free, one Cloudflare account)
Single Worker (Static Assets) serves the built PWA + `/api/*` + cron; KV namespace for state;
VAPID keypair (public in PWA, private as a Worker secret). Deployed via `wrangler`.
(Concrete build/deploy commands are added to this file as the code lands.)

## Constraints to respect
Free only (no Apple Developer, no paid host/domain). One small free cloud component is OK — keep
it small. **Support Android too**, not just iOS (different install/permission flow). Surface
hidden costs/limits honestly and up front.
