# Design: "Add padel game to phone calendar"

Date: 2026-06-30
Status: Approved (brainstorming) — ready for implementation plan
Spec for: a feature in [padel-reservas](../../../CLAUDE.md). Read `CLAUDE.md` and `docs/API.md` first.

## 1. Goal

Let the user add one of **their own** padel bookings to the phone's calendar, with a reminder
**15 minutes before** the game. The action is reachable from **both** the slot list (`SlotRow`)
and the **My bookings** screen. When the user later **cancels** a booking for which a calendar
event was created, show a **toast reminding them to delete the calendar event manually** (a PWA
cannot delete from the device calendar).

## 2. Constraints & key facts

- A web PWA **cannot write to the device calendar via any API**. The only cross-platform way to
  create an event with a custom alarm is generating an **`.ics`** file (iCalendar / RFC 5545) with a
  `VALARM` whose `TRIGGER:-PT15M`.
- An `.ics` event, once added, **cannot be programmatically updated or deleted** by us. This is the
  reason for the cancel-time reminder toast.
- iOS standalone PWA ignores the anchor `download` attribute → delivery needs an iOS fallback
  (open the blob/`data:` URL so iOS shows its native "Add to Calendar" sheet). **Must be verified on
  a real iPhone** (per CLAUDE.md "Verifying changes live" + iOS PWA gotchas).
- Scope (decided): button shows for **all of the user's future bookings** — anything `isMine`
  (vivienda + name), including `origin=izar4` and `origin=auto`. Only upcoming (matches existing
  My-bookings filter `fecha >= today` and `SlotRow` `!past`).
- Re-tap (decided): if an event was already created for this booking, **ask for confirmation**
  before adding again (`.ics` always creates a NEW event → avoid silent duplicates).
- Cancel toast (decided): **reminds the user to delete the orphaned event manually.**

## 3. Approach (delivery of the .ics)

**Chosen: anchor `download` + blob, with an `window.open`/`location.assign` fallback for iOS.**
- Android / desktop: temporary `<a download="padel-YYYYMMDD.ics">` click → calendar import opens.
- iOS standalone (download ignored): fall back to opening the blob/`data:` URL → iOS native
  "Add to Calendar" sheet.
- Triggered strictly inside the click handler; the optional `window.confirm` before it is synchronous
  so the user-gesture context is preserved (iOS won't block the open).

Rejected: `navigator.share({files})` (share sheet doesn't reliably offer "Add to Calendar" for
`.ics`); Google Calendar template URL (Google-only, login, can't reliably preset the 15-min reminder).

## 4. Components & data flow

### 4.1 `src/lib/ics.ts` (new, pure builder + side-effect trigger)
- `interface CalEvent { title: string; fecha: string /*YYYYMMDD*/; start: string /*HH:MM*/; end: string /*HH:MM*/; location: string; description: string; uid: string }`
- The caller composes `uid = ${fecha}-${slot}@izar4-padel` (stable per booking) and passes it in.
- `buildIcs(ev: CalEvent): string` — emits `VCALENDAR` + `VEVENT`:
  - `DTSTART`/`DTEND` as **floating local time** (`YYYYMMDDTHHMMSS`, no `TZID`) — correct for local
    Spanish time and matches the phone's clock.
  - `SUMMARY`, `LOCATION`, `DESCRIPTION` — escaped per RFC 5545 (`\` `;` `,` and newlines → `\n`).
  - `UID` taken from `ev.uid`.
  - `BEGIN:VALARM / ACTION:DISPLAY / TRIGGER:-PT15M / DESCRIPTION:<reminder> / END:VALARM`.
  - CRLF line endings.
- `downloadIcs(ev: CalEvent): void` — Blob `type:'text/calendar'` → `URL.createObjectURL` →
  anchor `download` click; iOS fallback opens the URL; `URL.revokeObjectURL` after.
- Pure `buildIcs` is unit-tested; `downloadIcs` (DOM) is not.

### 4.2 `src/lib/calendarEvents.ts` (new, localStorage flag store — mirrors `recentActions.ts`)
- Stores the set of booking keys (`${fecha}|${slot}`) for which an event was created **on this device**.
- `markCalendarAdded(key: string): void`
- `hasCalendarEvent(key: string): boolean`  (synchronous — used in the cancel flow)
- `clearCalendarEvent(key: string): void`
- `pruneCalendarEvents(beforeYmd: string): void`  (drop keys whose date < beforeYmd)
- **Why separate from `bookingsDb`:** avoids touching the cancel-code logic
  (`codigoUsed`/`getBookingCode`) and works for `origin=izar4` bookings that have no `BookingRecord`.

### 4.3 `src/components/Toast.tsx` + `useToast()` (new, shared)
- Extract the existing inline toast pattern from `WatchSheet.tsx` into a reusable component + hook:
  `{ msg, variant: 'success' | 'warn' }`, auto-dismiss ~3.8s.
- Consumed by `SlotsScreen` and `MyBookingsScreen`. `WatchSheet` is left unchanged (don't refactor
  working code beyond need).

### 4.4 `src/components/SlotRow.tsx` (modify)
- New prop `onAddCalendar?: () => void`.
- Render a `📅` button when `mine && slot.status === 'ocupado' && !slot.past`, beside the existing
  `×` cancel button. Widen the action column (~34 → ~74px) to hold two compact buttons in a flex row.

### 4.5 `src/screens/SlotsScreen.tsx` (modify)
- Add `addToCalendar(slot: SlotView)` handler: build `CalEvent` from `selected` date + `slot.franja`
  + `profile` + `slot.reservation`; if `hasCalendarEvent(key)` → `window.confirm(t('calendar.alreadyAddedConfirm'))`,
  bail on cancel; else `downloadIcs(ev)` → `markCalendarAdded(key)` → success toast; catch → warn toast.
- Pass `onAddCalendar={() => addToCalendar(s)}` into `SlotRow`.
- In `doCancel`: after success, if `hasCalendarEvent(key)` → warn toast `t('calendar.cancelReminder')`,
  then `clearCalendarEvent(key)`.
- Mount the shared `Toast`.

### 4.6 `src/screens/MyBookingsScreen.tsx` (modify)
- Add a `📅` button per row (beside "Cancel") wired to the same `addToCalendar`-style handler built
  from `res` + `franja` + `profile`.
- In `doCancel`: same cancel-reminder toast + `clearCalendarEvent(key)` logic.
- Mount the shared `Toast`.

## 5. Event content (default — tweak later if desired)
- `SUMMARY`: "Pádel 🎾"
- `LOCATION`: "IZAR 4 — Pista de pádel"
- `DESCRIPTION`: "{slot} · {start}–{end}" + apartment/name
- Reminder: 15 minutes before start (`TRIGGER:-PT15M`).
- izar4 data (name, apartment, "Pádel") shown verbatim, never translated (per CLAUDE.md i18n rule).

## 6. i18n (uk default, en, ru, es) — new `calendar.*` keys
- `calendar.add` (button aria/label), `calendar.added` (success toast),
  `calendar.alreadyAddedConfirm` (re-tap confirm), `calendar.error` (failure toast),
  `calendar.cancelReminder` (delete-manually toast), `calendar.eventTitle`, `calendar.eventLocation`,
  `calendar.reminderText` (VALARM description).

## 7. Tests (repo discipline: every lib has a .test.ts)
- `ics.test.ts`: `DTSTART`/`DTEND` derived correctly from `fecha`+`HH:MM`; `VALARM` present with
  `TRIGGER:-PT15M`; special-char escaping; stable `UID`; CRLF.
- `calendarEvents.test.ts`: mark / has / clear / prune behavior.

## 8. Out of scope (YAGNI)
- Editing or deleting calendar events from the app (web cannot).
- Configurable reminder lead time (fixed at 15 min).
- Changes to `WatchSheet`, the Worker, the cron, or push.
- Calendar button on past bookings.

## 9. Verification
- Unit tests (`npm test`) green.
- `npm run build` produces a valid PWA.
- **Live on a real iPhone (installed PWA) AND an Android device:** tapping `📅` on a slot and on a
  My-bookings row opens the system "Add to Calendar" flow with the right time and a 15-min reminder;
  cancelling such a booking shows the delete-reminder toast; re-tap shows the confirm. Clear the SW +
  caches between deploy checks (per CLAUDE.md).
