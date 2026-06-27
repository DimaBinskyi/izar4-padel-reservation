# Padel Reservas

A free, installable **PWA** to manage **padel** court reservations on
[izar4.es](https://izar4.es/reservas/), with real **push notifications** when a slot frees
up and optional **auto-grab** of freed slots — no app store, no Apple Developer account, no
paid server.

> **Why a PWA (not React Native):** iOS Web Push works on a home-screen PWA from iOS 16.4
> with no Apple Developer Program ($99/yr). That's the only free way to get closed-app push on
> iPhone. One small free Cloudflare Worker does the background polling + push and proxies the
> izar4 API (to avoid CORS).

## Status
Design complete. See:
- **Design spec:** [`docs/superpowers/specs/2026-06-27-padel-reservas-design.md`](docs/superpowers/specs/2026-06-27-padel-reservas-design.md)
- **izar4 API reference:** [`docs/API.md`](docs/API.md)

Implementation (PWA in `src/`, Cloudflare Worker in `worker/`) follows the implementation plan.

## Architecture (short)
`PWA (React + service worker)` ⇄ `1 Cloudflare Worker (proxy + KV + cron poll/grab/push)` ⇄ `izar4 WP REST API`, plus **Web Push (VAPID)** to the device.

## Highlights
- Month calendar (min = today), **21-day** booking horizon, live slot status + who booked.
- Fill profile once (Name, Apartment, Cancel code); re-prompt if lost; edit anytime.
- Book / cancel with confirmation modals; **per-booking code memory** (cancel works after code changes); cancel **own bookings only**.
- **Auto-grab** freed slots via a date+slot-range watchlist; respects **3/week + 1/day**.
- Notifications with per-type toggles, quiet hours, and an OS-permission gating flow (iOS + Android).
- Local statistics with a period selector (default: current month).
- 4 languages: **uk (default)**, en, ru, es.
- Auto-update via `vite-plugin-pwa`.

## Stack
Vite · React · TypeScript · vite-plugin-pwa · i18next · Cloudflare Workers + KV + Cron · Web Push (VAPID).

## Deploy (all free, one Cloudflare account)
Detailed steps come with the implementation. In short: `wrangler` deploy of the Worker
(serving the built PWA + `/api` + cron), a KV namespace, and a VAPID keypair.
