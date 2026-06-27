# Padel Reservas — Design Spec

**Date:** 2026-06-27
**Status:** Approved (brainstorming) → ready for implementation plan
**Owner:** Dima (dima@koolzone.com)

A personal, free, install-anywhere app to manage **padel** court reservations on
**izar4.es**, with real push notifications when a slot frees up and optional
**auto-grab** of freed slots. See [`docs/API.md`](../../API.md) for the full izar4 API.

---

## 1. Goal & guiding constraints

Manage padel reservations for the izar4 community **without running/paying for a real
server**, with notifications that work **even when the app is closed**, on **iOS and
Android**, **for the user personally** (no app-store distribution).

Hard constraints that shaped the design:
- **Free** — no Apple Developer Program ($99/yr), no paid hosting, no paid domain.
- **iOS closed-app push** required.
- **Backend-less in spirit** — at most one tiny free serverless component.

These constraints force a **PWA** (not React Native): since iOS 16.4 a home-screen PWA can
receive **Web Push** with **no Apple Developer account**, which native iOS cannot do for free.
A single free **Cloudflare Worker** supplies the only thing a phone cannot do itself
(background polling + sending push) and also proxies the izar4 API (to avoid CORS).

---

## 2. Key decisions (resolved during brainstorm + grill)

| # | Decision | Choice |
|---|---|---|
| 1 | Push strategy | **Web Push (VAPID)** sent from a Cloudflare Worker cron. Works on closed iOS 16.4+ PWA. |
| 2 | Stack | **PWA** — React + Vite + TypeScript + service worker. (Not React Native.) |
| 3 | Platforms | One codebase → **iOS (primary) + Android + desktop**. |
| 4 | Cloud | **One free Cloudflare Worker** = API proxy + push subscriptions (KV) + cron poll/grab/push. PWA on Cloudflare Pages. |
| 5 | Domain | Free `*.pages.dev` (e.g. `izar4-padel.pages.dev`). Custom domain optional later. |
| 6 | Resource | **Padel only.** |
| 7 | Booking horizon | **21 days** (server allows it — verified). Calendar shows ~1 month; days beyond horizon are view-only. Min day = today. |
| 8 | Limits | Respect **3/week + 1/day** (per vivienda). Fixed, **not user-editable**. Enforced by us (server doesn't). |
| 9 | Poll cadence | Every **2 min** active hours; every **10 min** during quiet hours **00:00–07:00**. |
| 10 | Notifications target | **Any cancellation** (slot freed) — global, padel, within the **7-day notification window**. (Distinct from the 21-day booking horizon — see note below.) |
| 11 | Auto-grab | **Yes** — per a date+slot-range watchlist; grabs first freed slot, ≤1/day, ≤3/week; sends an **important** "grabbed for you" push. |
| 12 | Identity of "mine" | **Limit count: strictly by vivienda.** Personal list / "my booking cancelled": **vivienda + name** (soft). |
| 13 | Profile in cloud | Stored in Worker KV (name, vivienda, **cancel code**) so the Worker can book on the user's behalf. Code is not secret on izar4 anyway. |
| 14 | Cancel scope | **Own bookings only.** Never display/harvest others' codes. |
| 15 | Languages | i18n: **uk (default)**, en, ru, es. Fully externalized strings. |
| 16 | Auto-update | `vite-plugin-pwa` `autoUpdate` + update check on focus. Worker deploys are instant for all. |

UI label renames (all locales): **Vivienda → "Apartment/Квартира"**, **Código → "Cancel
code/Код отмены"**. izar4 API field names are unchanged.

> **Two distinct time windows** (do not conflate):
> - **Booking horizon = 21 days** — how far ahead a slot can be booked / watched / grabbed.
> - **Notification window = 7 days** — how far ahead the generic "🆓 slot freed" push fires.
>
> The Worker diffs reservations over the full **21-day** horizon (so auto-grab works on any
> watched date), but only emits generic freed-slot notifications for the next **7 days**.
> Auto-grab "grabbed for you" notifications fire for any watched date regardless of the 7-day window.

---

## 3. Architecture

```
┌──────────────────────────┐     HTTPS      ┌───────────────────────────────┐    HTTPS   ┌──────────────┐
│   PWA (installed)         │  ───────────▶  │  Cloudflare Worker (free)     │ ─────────▶ │  izar4.es     │
│  React + service worker   │  ◀───────────  │  • /api/* proxy → izar4 (CORS)│ ◀───────── │  WP REST API  │
│  • screens & local state  │                │  • /subscribe (KV)            │            └──────────────┘
│  • IndexedDB/localStorage │                │  • Cron: poll→diff→grab→push  │
└─────────▲────────────────┘                │  • KV: subs, profile, watch,  │
          │  Web Push (VAPID)               │       prefs, last snapshot    │
          └─────────────────────────────────┤  • Static assets (the PWA)    │
                                             └───────────────────────────────┘
```

- **PWA** does everything interactive and stores all personal data locally. It talks to izar4
  **only via the Worker proxy** (CORS).
- **Worker** is the only always-on piece. If it is down, manual browse/book/cancel still works
  *iff* CORS allowed — but since CORS is unreliable we route through the proxy, so the Worker is
  effectively required for live data. Background features (auto-grab, push) require it by nature.
- **Web Push** is sent from the Worker directly to the device push service (APNs/FCM via the
  standard Web Push protocol). No Apple Developer account needed.

### Hosting layout (all on one free Cloudflare account)
- **Single Worker with Static Assets**: serves the built PWA *and* exposes `/api/*`,
  `/subscribe`, and a **Cron Trigger**. One URL, one deploy. (Falls back to Pages + separate
  Worker if Static Assets + Cron in one Worker proves awkward.)
- **KV namespace** for state. **VAPID** keypair: public in the PWA, private in the Worker secret.

---

## 4. Tech stack

- **Frontend:** Vite + React + TypeScript.
- **PWA/service worker:** `vite-plugin-pwa` (`registerType: 'autoUpdate'`, Workbox) — offline app
  shell + push receiver + auto-update.
- **i18n:** `i18next` + `react-i18next`, JSON resource files per locale; default `uk`.
- **State/storage:** lightweight (Zustand or React context). Persistence: `localStorage` for
  profile/settings/device-secret; **IndexedDB** for the bookings/stats log and per-booking code map.
- **Push:** Web Push API + `PushManager` on the client; Web Push protocol (VAPID, e.g.
  `@block65/webcrypto-web-push` or equivalent) from the Worker.
- **Backend:** Cloudflare Workers (TypeScript) + Workers KV + Cron Triggers, deployed with
  `wrangler`.

---

## 5. Data model

### 5.1 Local (device)
- **Profile** (`localStorage`): `{ nombre, vivienda, codigo }`. Filled once; re-prompted if missing.
- **Settings** (`localStorage`): language; notification toggles; quiet-hours config; (limits are
  fixed, shown read-only).
- **Device secret** (`localStorage`): random id used to authenticate to the Worker.
- **Bookings/stats log** (IndexedDB): one record per booking the app knows about:
  `{ reservaId, fecha, franja, slotStart, slotEnd, nombre, vivienda, codigoUsed, origin, status, createdAt, cancelledAt }`
  - `origin`: `app` | `auto` | `izar4` (website) | `unknown`.
  - `status`: `active` | `played` | `cancelled`.
  - `codigoUsed`: **the code used for that specific booking** (so cancel still works after the
    profile code changes).

### 5.2 Cloud (Worker KV), keyed by device secret
- **Push subscription** (endpoint + keys).
- **Profile copy** (name, vivienda, code) — needed for auto-grab booking.
- **Watchlist**: `[{ fecha, franjas:[...], active }]`.
- **Notification prefs** (which types, quiet-hours window + night-allowed types).
- **Last snapshot** of padel reservations (set of occupied `fecha|franja` keys for the horizon)
  for diffing between polls.
- **Grabbed bookings** (id + codigo used) so the device can sync them into its local code map.

---

## 6. Screens (11 mockups approved)

Bottom tab bar (4): **Slots · Watch · Stats · Settings**. "My bookings" is reached via a chip on Slots.

1. **Slots (home).** Header: language, title, settings. Sub-bar chips: weekly remaining
   (`1/3`), profile (`P3-7 · Dmytro`), **"My bookings · N"** entry. Month date strip (min =
   today; days beyond 21-day horizon view-only). Slot rows: time · status (Past / Free / Mine /
   Busy / **Watching**) · who (name + apartment) · action: **+** book, **×** cancel own,
   **🎯** watch a busy slot.
2. **Booking confirmation modal.** Shows resource/date/slot + **the data we book with** (name,
   apartment, cancel code) + post-booking weekly count. Confirm/Cancel.
3. **Watch (auto-grab) tab.** "New watch": pick date + **range bounded by actual slots** (from/to)
   with a **live preview** of which slots will be caught. List of active watches with status
   (Active / ✅ Grabbed / ⛔ Off: weekly limit reached) + delete.
4. **Stats.** **Period selector (default: current month)** = Week / Month / All / Custom.
   Counters, favourite slot, cancellations, auto-grabbed, hours; history list with
   played/grabbed/cancelled tags.
5. **Settings.** Profile (Name, Apartment, Cancel code → Edit); Language (uk default);
   Notification toggles; Quiet hours; Limits (read-only 3/wk, 1/day); Version + auto-update.
6. **First-run / re-prompt profile modal.** Name, Apartment (autocomplete from `inmuebles`),
   Cancel code. Shown when profile missing.
7. **Edit profile** (same three fields, from Settings).
8. **Cancel confirmation modal.** Two states: code remembered → one tap; code unknown → code
   field (prefilled with profile code).
9. **My bookings.** All upcoming bookings matched as mine (live izar4 data), across dates, with
   origin badges and cancel.
10. **My-bookings entry + origin badges.** Blue "🗂 My bookings · N" chip on Slots; badges 📱 app
    / 🎯 auto / 🌐 izar4 (code matched → 1 tap / code differs → ask).
11. **Notification-permission flow.** States A (not installed), B (priming), C (denied) — see §10.
12. **Install prompt.** Dismissible banner: Android/desktop one-tap install (`beforeinstallprompt`);
    iOS shows Share → "Add to Home Screen" instructions; hidden when already running standalone.
    Re-offerable from Settings. (Added in Phase 2; reused by the notification flow's state A.)

Mockups are saved under `.superpowers/brainstorm/` (gitignored).

---

## 7. Booking & cancellation logic

### 7.1 Create (manual)
1. Validate profile present; if not → first-run modal.
2. Pre-checks (client, mirroring izar4 + our policy): not past/blocked; within 21-day horizon;
   weekly count for vivienda `< 3`; daily count for vivienda `< 1`.
3. `POST /api/app/v1/reservar` (via proxy) with `{titulo, idFranja, fecha, nombre, vivienda,
   codigo, idTermino:12}`.
4. On `ok` → record in local log with `origin:'app'`, `codigoUsed = profile.codigo`; optimistic
   UI update; refetch with cache-bust shortly after (read-after-write lag).

### 7.2 Identify "mine"
- **Limit counting:** strictly by **vivienda** (mirrors izar4's per-dwelling rule → honest counter).
- **Personal list / "my booking cancelled":** by **vivienda + name** (soft match).

### 7.3 Cancel decision tree (for a booking matched as mine)
1. **Code remembered locally** (origin app/auto) → cancel in one tap with `codigoUsed`.
2. **Not remembered**, but the booking's `codigo_cancelacion` (from API) **equals the profile
   code** → normal one-tap cancel; tag origin `izar4` (made on the website). *(API code is used
   only as an equality check against the user's own code — never revealed.)*
3. **Code differs** → ask the user to enter the code (prefilled with profile code).
- `POST /api/app/v1/cancelar {idReserva, codigo}`. On `codigo_incorrecto` → inline error, ask for
  the correct code. On success → update log/stats, optimistic UI, refetch.

### 7.4 Security
- Cancel action only appears on bookings matched as mine.
- Others' codes are never shown or used. Requiring the correct code for unknown bookings doubles
  as proof-of-ownership, so a soft name-match false positive still can't cancel someone else's slot.

---

## 8. Auto-grab (watchlist)

- A **watch** = `{ fecha, franjas[] }` where `franjas` is the contiguous slot range the user picked
  (preview shows exactly which slots).
- The Worker, each poll, computes freed slots (occupied→free) within the horizon. For each active
  watch whose date/franjas include a freed slot:
  1. Check policy: would booking exceed **1/day** (for that date) or **3/week** (that vivienda)? If
     yes → **disable** the watch and send the "⛔ auto-grab off: weekly limit reached" push.
  2. Otherwise `POST reservar` with the stored profile (its `codigo`). On success → record the
     grabbed booking (id + code) for device sync, mark watch **Grabbed**, send the **important**
     "🎯 grabbed for you" push.
  3. On race (someone booked first) → keep watching the remaining franjas.
- **Past-slot rule (cutoff = slot START time):** a freed slot whose start time has already passed is
  treated as past/unbookable (mirrors izar4; `minutos_antelacion_min` = 0 for padel). The Worker
  **never grabs** such a slot and **does not** send a "slot freed" push for it. The start-vs-now
  check happens at grab time, so the 2-min poll lag can never cause an already-started slot to be
  grabbed. (Example: watch on 10:00–11:30, a cancellation frees it at 10:01 → skipped, no push.)
- **Watch expiry:** a watch stays active for its still-future slots. When **all** of a watch's slots
  have passed their start time (or the date itself is past) with no catch, the Worker
  **auto-deactivates** it (status "⌛ Expired") and sends one informational "watch expired" push
  (its own toggle, default on). A watch where only *some* slots have passed stays active for the rest.
- Limit exhaustion can be triggered by **manual bookings or grabs** alike; the Worker re-evaluates
  every poll and disables affected watches with a notification.

---

## 9. Notifications

### 9.1 Types (each a toggle in Settings; Worker sends only enabled ones)
- Master on/off.
- 🆓 Slot freed (any cancellation, padel, **next 7 days** = notification window); only slots whose
  start time hasn't passed (past slots are not actionable, so no push).
- 🎯 Grabbed for you (auto-grab succeeded) — **important**; default on.
- ⛔ Auto-grab disabled (weekly limit reached).
- ⌛ Watch expired (a watch's slots all passed without a catch); default on.
- ❌ My booking cancelled (detected by vivienda + name).
- **Suppress my own actions:** don't notify about slots the user themselves just booked/cancelled
  (default on). Implemented by the device telling the Worker its recent self-actions (or the Worker
  ignoring changes that match the user's just-synced action), so the diff skips them.

### 9.2 Quiet hours
- **Toggle, default OFF.** Editable window (default 00:00–07:00).
- When ON → a **sub-list** chooses which types **may still** be sent during the window (others are
  muted). Polling still runs (every 10 min at night) so auto-grab keeps working; only "chatty"
  notifications are muted per the sub-list.

### 9.3 Notification content & tap
- Title/body localized; e.g. "🆓 Slot freed — Sat 28 Jun, 19:00–20:30". Tapping opens the PWA to
  that date (deep link via the service worker `notificationclick`).

---

## 10. Notification-permission gating (iOS + Android)

Detect on load and on `visibilitychange`: installed (standalone) vs browser tab; platform; iOS
version capability (`'PushManager' in window` inside standalone); `Notification.permission`;
subscription presence.

- **Not installed:**
  - **iOS** → instructions: Share → "Add to Home Screen" (iOS gives no install API, no
    `beforeinstallprompt`).
  - **Android / desktop** → capture `beforeinstallprompt`, suppress the default mini-infobar, and
    offer **one-tap Install** via the saved event's `.prompt()`.
  Push requires install on iOS; strongly recommended on Android. The same logic powers a standalone,
  dismissible **install banner** (screen 12) shown outside the notification flow; detect
  already-installed via `display-mode: standalone` / iOS `navigator.standalone` and hide it then.
- **Permission `default` (installed):** show **priming** screen first, then call
  `Notification.requestPermission()` from the tap (a denied state is permanent for the web API, so
  never prompt cold).
- **Permission `denied`:** warning banner + platform-specific manual steps:
  - iOS: Settings → (app) → Notifications → Allow.
  - Android: Settings → Apps → (app)/Site settings → Notifications → Allow.
  Web cannot open OS settings or deep-link, so we guide and **auto-recheck on return**.
- **`granted` but no/expired subscription:** (re)subscribe silently and `POST /subscribe`.
- **Settings screen** shows a warning chip above the toggles whenever OS-level notifications are off.

---

## 11. Worker logic

- **`/api/*`** — proxy to `https://izar4.es/wp-json/*`, adding CORS headers for the PWA origin;
  pass through GET/POST bodies. Guarded by the device secret.
- **`/subscribe`** — upsert `{subscription, profile, watchlist, prefs}` in KV under the device secret.
- **Cron** (every minute; the handler decides whether to act based on time → 2-min cadence by day,
  10-min by night):
  1. Fetch padel `reservas` over the full **21-day** booking horizon (cache-busted).
  2. Build occupied-key set; **diff** vs the stored snapshot → `freed` and `added`.
  3. For each device: run **auto-grab** for matching watches on **any** watched date (respecting
     limits, disabling as needed); compute which notifications to send — generic "freed" only for
     the **next 7 days**, "grabbed"/"my-cancelled"/"limit-off" for any relevant date — honoring
     prefs + quiet-hours + self-action suppression; **send Web Push**.
  4. Save the new snapshot.
- **Backward-compatible API**: Worker can be redeployed anytime without breaking older PWA clients.

---

## 12. Internationalization

- `i18next` with resource files: `src/i18n/{uk,en,ru,es}.json`. **Default & fallback: `uk`.**
- All UI strings are keys; no hard-coded text. Dates/times formatted per locale (`Intl`).
- izar4 data (neighbour names, "Pádel", apartment refs) is shown verbatim, not translated.
- Language switch in Settings; persisted in `localStorage`.

---

## 13. Auto-update

- `vite-plugin-pwa` `autoUpdate`: new build on Pages → service worker fetches new assets and
  activates; page refreshes to latest (applied at a safe moment, not mid-form).
- Extra `registration.update()` on `visibilitychange`/focus so long-open sessions update.
- Worker changes are live immediately for everyone (server-side), no client action.

---

## 14. Security & privacy

- Personal data lives on-device; the KV copy (for auto-grab) is keyed by a device secret and only
  used to act on the user's behalf. The cancel code is not secret on izar4 (publicly returned), so
  KV storage adds no new exposure.
- The app never displays or harvests other people's cancel codes; cancel is restricted to own
  bookings; unknown-booking cancels require the correct code (proof of ownership).
- Worker endpoints require the device secret; the proxy is not an open relay.
- Honest, conservative limit policy (3/week, 1/day) to avoid abusing the community court.
  Honest flag: booking beyond izar4's 7-day UI window / its limits is outside the site's intended
  use and could be reverted by admins — accepted by the user.

---

## 15. Error handling & edge cases

- **Read-after-write lag** → optimistic UI + cache-busted refetch + reconcile on next poll.
- **Offline** → cached app shell + last-seen data, with an offline banner; writes disabled.
- **Grab race** (slot taken first) → keep watching remaining franjas; no error to user.
- **Permission denied / not installed** → gating flow (§10).
- **Code mismatch on cancel** → ask for the correct code.
- **Profile/log lost (reinstall)** → re-prompt profile; active bookings cancellable via code-match
  or manual entry; device secret regenerates (KV state for the old secret is orphaned/expired).
- **Date format variance / weekday codes** → normalize per `docs/API.md` §4.
- **izar4 or Worker down** → friendly error + retry; background features pause.

---

## 16. Testing strategy

- **Unit:** status derivation (free/busy/blocked/past), limit counting (per-vivienda week/day),
  date normalization, diff (freed/added), cancel decision tree, quiet-hours/self-suppression logic.
- **Integration (against a mock/proxy):** book→appears, cancel→disappears, read-after-write lag
  handling. Live izar4 write tests must always **create-then-cancel** and verify cleanup (as done
  during research).
- **Worker:** cron diff + grab + push with a fake KV and a stub izar4; VAPID signing.
- **PWA/manual:** install on a real iPhone (iOS 16.4+) and Android; permission flow A/B/C; receive a
  push with the app closed; auto-update picks up a new deploy.
- **i18n:** every screen in all 4 locales; uk default on fresh install.

---

## 17. Out of scope (v1) / future

- Recurring watch patterns ("every Tuesday evening").
- Club social resource (data model already supports it; padel-only for v1).
- Custom domain (cosmetic; `*.pages.dev` for now).
- Multi-device profile sync / accounts.
- Notification action buttons (unreliable on iOS web push).

---

## 18. Deliverables & repo layout (everything under `padel-reservas/`)

```
padel-reservas/
  docs/
    API.md                         # izar4 API reference (done)
    superpowers/specs/2026-06-27-padel-reservas-design.md  # this spec
  src/                             # PWA (React) — created in implementation
  worker/                          # Cloudflare Worker — created in implementation
  .gitignore
  README.md
```
Nothing related to this app remains in `~/Documents/dev/` root (research artifacts cleaned).
