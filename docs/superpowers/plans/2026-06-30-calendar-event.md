# Add Padel Game to Phone Calendar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user add their own padel booking to the phone calendar (with a 15-min reminder) from both the slot list and the My-bookings screen, and remind them to delete the event manually when they cancel a booking they had added.

**Architecture:** A pure `.ics` (iCalendar) builder + a download/open trigger (with an iOS fallback); a tiny localStorage flag store recording which bookings got a calendar event (per device); a thin orchestration helper; a shared toast component. Two screens (`SlotsScreen`, `MyBookingsScreen`) and one row component (`SlotRow`) gain a `📅` button and wire the cancel-time reminder.

**Tech Stack:** Vite + React + TypeScript, i18next (uk/en/ru/es), Vitest (jsdom). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-30-calendar-event-design.md`

---

## File Structure

- **Create** `src/lib/ics.ts` — pure `buildIcs(CalEvent)` + `buildBookingEvent()`, and the DOM side-effect `downloadIcs()`. One responsibility: turn a booking into an `.ics` and hand it to the OS.
- **Create** `src/lib/ics.test.ts` — unit tests for `buildIcs` + `buildBookingEvent`.
- **Create** `src/lib/calendarEvents.ts` — localStorage flag store (`mark/has/clear/prune`). Mirrors `src/lib/recentActions.ts`.
- **Create** `src/lib/calendarEvents.test.ts` — unit tests for the flag store.
- **Create** `src/lib/calendar.ts` — `addBookingToCalendar()` orchestration (confirm-if-duplicate → download → mark). Imports `ics` + `calendarEvents`.
- **Create** `src/components/Toast.tsx` — reusable `useToast()` hook + `<Toast>` (extracted from the inline pattern in `WatchSheet.tsx`).
- **Modify** `src/components/SlotRow.tsx` — add optional `onAddCalendar` prop + `📅` button; widen the action column.
- **Modify** `src/screens/SlotsScreen.tsx` — `addToCalendar` handler, mount `Toast`, cancel-time reminder.
- **Modify** `src/screens/MyBookingsScreen.tsx` — per-row `📅` button, mount `Toast`, cancel-time reminder.
- **Modify** `src/i18n/locales/{uk,en,ru,es}.json` — new `calendar.*` keys.

---

## Task 1: `.ics` builder (`src/lib/ics.ts`)

**Files:**
- Create: `src/lib/ics.ts`
- Test: `src/lib/ics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/ics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildIcs, buildBookingEvent, type CalEvent } from './ics';

const ev: CalEvent = {
  title: 'Pádel 🎾',
  fecha: '20260703',
  start: '09:00',
  end: '10:00',
  location: 'IZAR 4 — Pista de pádel',
  description: 'P1-1 · 09:00–10:00 · Dmytro · P3-7',
  uid: '20260703-P1-1@izar4-padel',
};

describe('buildIcs', () => {
  const out = buildIcs(ev);

  it('wraps a VEVENT in a VCALENDAR', () => {
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('END:VEVENT');
    expect(out).toContain('END:VCALENDAR');
  });

  it('derives floating local DTSTART/DTEND from fecha + HH:MM (no TZID)', () => {
    expect(out).toContain('DTSTART:20260703T090000');
    expect(out).toContain('DTEND:20260703T100000');
    expect(out).not.toContain('TZID');
  });

  it('includes a 15-minute display alarm', () => {
    expect(out).toContain('BEGIN:VALARM');
    expect(out).toContain('ACTION:DISPLAY');
    expect(out).toContain('TRIGGER:-PT15M');
  });

  it('carries the stable UID and uses CRLF line endings', () => {
    expect(out).toContain('UID:20260703-P1-1@izar4-padel');
    expect(out).toContain('\r\n');
  });

  it('escapes backslash, comma and semicolon per RFC 5545', () => {
    const e = buildIcs({ ...ev, description: 'a,b;c\\d' });
    expect(e).toContain('DESCRIPTION:a\\,b\\;c\\\\d');
  });
});

describe('buildBookingEvent', () => {
  it('composes the stable UID and copies labels', () => {
    const built = buildBookingEvent(
      { fecha: '20260703', slot: 'P1-1', start: '09:00', end: '10:00' },
      { title: 'Pádel 🎾', location: 'IZAR 4 — Pista de pádel', description: 'P1-1 · 09:00–10:00' },
    );
    expect(built.uid).toBe('20260703-P1-1@izar4-padel');
    expect(built.fecha).toBe('20260703');
    expect(built.start).toBe('09:00');
    expect(built.end).toBe('10:00');
    expect(built.title).toBe('Pádel 🎾');
    expect(built.location).toBe('IZAR 4 — Pista de pádel');
    expect(built.description).toBe('P1-1 · 09:00–10:00');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/ics.test.ts`
Expected: FAIL — `Failed to resolve import "./ics"` / `buildIcs is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/ics.ts`:

```ts
// Build an iCalendar (.ics) event for a padel booking and hand it to the OS calendar.
// A PWA cannot write the device calendar via any API; an .ics with a VALARM is the only
// cross-platform way to create an event with a custom reminder.

export interface CalEvent {
  title: string;
  fecha: string; // YYYYMMDD
  start: string; // HH:MM
  end: string; // HH:MM
  location: string;
  description: string;
  uid: string;
}

// Escape TEXT values per RFC 5545: backslash, semicolon, comma, and newlines.
function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// "HH:MM" -> "HHMMSS" (drop the colon, append seconds).
function hms(t: string): string {
  return t.replace(':', '') + '00';
}

// Assemble a CalEvent from a booking's primitives plus already-localized labels.
export function buildBookingEvent(
  b: { fecha: string; slot: string; start: string; end: string },
  labels: { title: string; location: string; description: string },
): CalEvent {
  return {
    title: labels.title,
    fecha: b.fecha,
    start: b.start,
    end: b.end,
    location: labels.location,
    description: labels.description,
    uid: `${b.fecha}-${b.slot}@izar4-padel`,
  };
}

export function buildIcs(ev: CalEvent): string {
  // Floating local time (no TZID): the calendar interprets it in the device's timezone,
  // which matches the local Spanish slot times.
  const dtStart = `${ev.fecha}T${hms(ev.start)}`;
  const dtEnd = `${ev.fecha}T${hms(ev.end)}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//izar4-padel//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(ev.title)}`,
    `LOCATION:${esc(ev.location)}`,
    `DESCRIPTION:${esc(ev.description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(ev.title)}`,
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

// iOS (Safari or standalone PWA) ignores the <a download> attribute; opening the blob URL
// makes iOS show its native "Add to Calendar" sheet. Android/desktop honor the download.
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /ipad|iphone|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Side effect: trigger the OS "add to calendar" flow. Not unit-tested (DOM/navigator).
export function downloadIcs(ev: CalEvent): void {
  const blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  if (isIos()) {
    window.location.assign(url);
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = `padel-${ev.fecha}.ics`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/ics.test.ts`
Expected: PASS (2 describe blocks, all assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ics.ts src/lib/ics.test.ts
git commit -m "feat(calendar): .ics builder with 15-min VALARM

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Calendar-event flag store (`src/lib/calendarEvents.ts`)

**Files:**
- Create: `src/lib/calendarEvents.ts`
- Test: `src/lib/calendarEvents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendarEvents.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { markCalendarAdded, hasCalendarEvent, clearCalendarEvent, pruneCalendarEvents } from './calendarEvents';

beforeEach(() => localStorage.clear());

describe('calendarEvents', () => {
  it('mark then has', () => {
    expect(hasCalendarEvent('20260703|P1-1')).toBe(false);
    markCalendarAdded('20260703|P1-1');
    expect(hasCalendarEvent('20260703|P1-1')).toBe(true);
  });

  it('mark is idempotent (no duplicate keys)', () => {
    markCalendarAdded('20260703|P1-1');
    markCalendarAdded('20260703|P1-1');
    expect(JSON.parse(localStorage.getItem('padel_calendar_events')!)).toEqual(['20260703|P1-1']);
  });

  it('clear removes the key', () => {
    markCalendarAdded('20260703|P1-1');
    clearCalendarEvent('20260703|P1-1');
    expect(hasCalendarEvent('20260703|P1-1')).toBe(false);
  });

  it('prune drops keys whose date is before the cutoff', () => {
    markCalendarAdded('20260601|P1-1');
    markCalendarAdded('20260705|P1-2');
    pruneCalendarEvents('20260630');
    expect(hasCalendarEvent('20260601|P1-1')).toBe(false);
    expect(hasCalendarEvent('20260705|P1-2')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/calendarEvents.test.ts`
Expected: FAIL — `Failed to resolve import "./calendarEvents"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendarEvents.ts`:

```ts
// Per-device record of which bookings the user created a phone-calendar event for.
// Keyed by `${fecha}|${slot}` (same key as bookingsDb). Used to (a) confirm before adding a
// duplicate and (b) remind the user to delete the orphaned event when they cancel.
const KEY = 'padel_calendar_events';

function load(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function save(keys: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(keys));
}

export function markCalendarAdded(key: string): void {
  const list = load();
  if (!list.includes(key)) {
    list.push(key);
    save(list);
  }
}

export function hasCalendarEvent(key: string): boolean {
  return load().includes(key);
}

export function clearCalendarEvent(key: string): void {
  save(load().filter((k) => k !== key));
}

// Drop keys whose game date (the `fecha` part of the key) is before `beforeYmd`.
export function pruneCalendarEvents(beforeYmd: string): void {
  save(load().filter((k) => k.split('|')[0] >= beforeYmd));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/calendarEvents.test.ts`
Expected: PASS (4 assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendarEvents.ts src/lib/calendarEvents.test.ts
git commit -m "feat(calendar): per-device flag store for created events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Orchestration helper (`src/lib/calendar.ts`)

**Files:**
- Create: `src/lib/calendar.ts`

(No test: the function's only branch that doesn't hit the DOM is trivial, and the rest calls `downloadIcs` which uses `URL.createObjectURL` — not available under jsdom. Logic is covered by `ics.test.ts` + `calendarEvents.test.ts`.)

- [ ] **Step 1: Write the implementation**

Create `src/lib/calendar.ts`:

```ts
import { downloadIcs, type CalEvent } from './ics';
import { hasCalendarEvent, markCalendarAdded } from './calendarEvents';

// Add a booking's event to the phone calendar. If an event was already created for this booking,
// ask the caller's confirm() first (an .ics always creates a NEW event → avoid silent duplicates).
// Returns true when the .ics was triggered, false when the user declined the duplicate prompt.
export function addBookingToCalendar(ev: CalEvent, key: string, confirmDuplicate: () => boolean): boolean {
  if (hasCalendarEvent(key) && !confirmDuplicate()) return false;
  downloadIcs(ev);
  markCalendarAdded(key);
  return true;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/calendar.ts
git commit -m "feat(calendar): addBookingToCalendar orchestration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Shared toast (`src/components/Toast.tsx`)

**Files:**
- Create: `src/components/Toast.tsx`

(No test: the repo has no component tests; styling matches the existing inline toast in `WatchSheet.tsx`.)

- [ ] **Step 1: Write the implementation**

Create `src/components/Toast.tsx`:

```tsx
import { useCallback, useRef, useState } from 'react';

export type ToastVariant = 'success' | 'warn';
export interface ToastState {
  msg: string;
  variant: ToastVariant;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((msg: string, variant: ToastVariant = 'success') => {
    setToast({ msg, variant });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);
  return { toast, show };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  const warn = toast.variant === 'warn';
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, top: 'calc(env(safe-area-inset-top) + 12px)', display: 'flex', justifyContent: 'center', zIndex: 70, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: 360,
          margin: '0 14px',
          borderRadius: 12,
          padding: '10px 14px',
          fontSize: 12.5,
          boxShadow: '0 6px 20px rgba(0,0,0,.4)',
          ...(warn
            ? { background: '#241a00', border: '1px solid #4a3a12', color: '#f2c14e' }
            : { background: '#0e2018', border: '1px solid #234e34', color: '#a7e8c1' }),
        }}
      >
        {warn ? '⚠️ ' : ''}
        {toast.msg}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Toast.tsx
git commit -m "feat(ui): reusable Toast component + useToast hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: i18n keys (`calendar.*` in all 4 locales)

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/ru.json`
- Modify: `src/i18n/locales/uk.json`
- Modify: `src/i18n/locales/es.json`

In each file, the last top-level block is `"watch": { … }`. Add a comma after that block's closing `}` and insert a new `"calendar"` block before the file's final `}`.

- [ ] **Step 1: en.json** — change the tail (currently):

```json
    "toastHasFree": "Your selection includes free slots — pick only busy ones (free slots are bookable now)."
  }
}
```

to:

```json
    "toastHasFree": "Your selection includes free slots — pick only busy ones (free slots are bookable now)."
  },
  "calendar": {
    "add": "Add to calendar",
    "added": "Added to calendar ✓",
    "alreadyAddedConfirm": "You already added this game to your calendar. Add it again?",
    "error": "Couldn't open the calendar. Try again.",
    "cancelReminder": "You added this game to your calendar — delete that event manually.",
    "eventTitle": "Pádel 🎾",
    "eventLocation": "IZAR 4 — Pista de pádel"
  }
}
```

- [ ] **Step 2: ru.json** — add the same-shaped block after the `watch` block (comma after `watch`'s closing `}`):

```json
  "calendar": {
    "add": "В календарь",
    "added": "Добавлено в календарь ✓",
    "alreadyAddedConfirm": "Эта игра уже добавлялась в календарь. Добавить ещё раз?",
    "error": "Не удалось открыть календарь. Попробуйте ещё раз.",
    "cancelReminder": "Вы добавляли эту игру в календарь — удалите событие вручную.",
    "eventTitle": "Pádel 🎾",
    "eventLocation": "IZAR 4 — Корт для падела"
  }
```

- [ ] **Step 3: uk.json** — add after the `watch` block (comma after `watch`'s closing `}`):

```json
  "calendar": {
    "add": "У календар",
    "added": "Додано в календар ✓",
    "alreadyAddedConfirm": "Цю гру вже додавали в календар. Додати ще раз?",
    "error": "Не вдалося відкрити календар. Спробуйте ще раз.",
    "cancelReminder": "Ви додавали цю гру в календар — видаліть подію вручну.",
    "eventTitle": "Pádel 🎾",
    "eventLocation": "IZAR 4 — Корт для падела"
  }
```

- [ ] **Step 4: es.json** — add after the `watch` block (comma after `watch`'s closing `}`):

```json
  "calendar": {
    "add": "Añadir al calendario",
    "added": "Añadido al calendario ✓",
    "alreadyAddedConfirm": "Ya añadiste este partido al calendario. ¿Añadirlo de nuevo?",
    "error": "No se pudo abrir el calendario. Inténtalo de nuevo.",
    "cancelReminder": "Añadiste este partido al calendario — elimina el evento manualmente.",
    "eventTitle": "Pádel 🎾",
    "eventLocation": "IZAR 4 — Pista de pádel"
  }
```

- [ ] **Step 5: Verify the JSON is valid**

Run: `node -e "['uk','en','ru','es'].forEach(l=>{const o=require('./src/i18n/locales/'+l+'.json'); if(!o.calendar||!o.calendar.add) throw new Error(l+' missing calendar.add'); }); console.log('ok')"`
Expected: `ok` (no JSON parse error, all locales have `calendar.add`).

- [ ] **Step 6: Commit**

```bash
git add src/i18n/locales/uk.json src/i18n/locales/en.json src/i18n/locales/ru.json src/i18n/locales/es.json
git commit -m "i18n(calendar): add calendar.* keys in uk/en/ru/es

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `SlotRow` — add the `📅` button

**Files:**
- Modify: `src/components/SlotRow.tsx`

- [ ] **Step 1: Add the `onAddCalendar` prop**

In `interface Props`, add the new optional callback after `onWatch`:

```tsx
  onWatch: () => void;    // for busy slots that aren't mine
  onAddCalendar?: () => void;  // add this own booking to the phone calendar
  highlight?: boolean;    // briefly blink + scroll into view (when jumped to from My bookings)
```

- [ ] **Step 2: Destructure the new prop**

Change the component signature line:

```tsx
export function SlotRow({ slot, mine, canBook, highlight, onBook, onCancel, onWatch }: Props) {
```

to:

```tsx
export function SlotRow({ slot, mine, canBook, highlight, onBook, onCancel, onWatch, onAddCalendar }: Props) {
```

- [ ] **Step 3: Replace the action-column block**

Replace the entire action `<div style={{ width: 34 }}> … </div>` block (the last child div, currently lines ~48-61) with:

```tsx
      <div style={{ width: 74, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        {slot.status === 'libre' && canBook && (
          <button onClick={onBook} aria-label="book"
            style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: '#1d4ed8', color: '#fff', fontSize: 17, fontWeight: 700 }}>+</button>
        )}
        {slot.status === 'ocupado' && mine && !slot.past && (
          <>
            <button onClick={onAddCalendar} aria-label="add to calendar"
              style={{ width: 32, height: 34, borderRadius: 10, border: 'none', background: '#16202e', color: '#cfe0f5', fontSize: 15 }}>📅</button>
            <button onClick={onCancel} aria-label="cancel"
              style={{ width: 32, height: 34, borderRadius: 10, border: 'none', background: '#3a1620', color: '#ff8a8a', fontSize: 17, fontWeight: 700 }}>×</button>
          </>
        )}
        {slot.status === 'ocupado' && !mine && !slot.past && (
          <button onClick={onWatch} aria-label="watch"
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid #4a3a12', background: '#221a06', color: '#f2c14e', fontSize: 15 }}>🎯</button>
        )}
      </div>
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SlotRow.tsx
git commit -m "feat(slots): calendar button on own slot rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `SlotsScreen` — wire add-to-calendar + toast + cancel reminder

**Files:**
- Modify: `src/screens/SlotsScreen.tsx`

- [ ] **Step 1: Add imports**

After the existing `import { recordBooking, markCancelled, bookingKey } from '../lib/bookingsDb';` line, add:

```tsx
import { buildBookingEvent } from '../lib/ics';
import { addBookingToCalendar } from '../lib/calendar';
import { hasCalendarEvent, clearCalendarEvent } from '../lib/calendarEvents';
import { Toast, useToast } from '../components/Toast';
```

- [ ] **Step 2: Create the toast inside the component**

Immediately after `const { t, i18n } = useTranslation();`, add:

```tsx
  const { toast, show } = useToast();
```

- [ ] **Step 3: Add the `addToCalendar` handler**

Add this function just above `function tryBook(slot: SlotView) {`:

```tsx
  function addToCalendar(slot: SlotView) {
    if (!profile) return;
    const f = slot.franja;
    const key = bookingKey(selected, f.slot);
    const ev = buildBookingEvent(
      { fecha: selected, slot: f.slot, start: f.start, end: f.end },
      {
        title: t('calendar.eventTitle'),
        location: t('calendar.eventLocation'),
        description: `${f.slot} · ${f.start}–${f.end} · ${profile.nombre} · ${profile.vivienda}`,
      },
    );
    try {
      if (addBookingToCalendar(ev, key, () => window.confirm(t('calendar.alreadyAddedConfirm')))) {
        show(t('calendar.added'), 'success');
      }
    } catch {
      show(t('calendar.error'), 'warn');
    }
  }
```

- [ ] **Step 4: Show the cancel reminder in `doCancel`**

In `doCancel`, after the line `await forceLive();` and before `setCancelSlot(null);`, add:

```tsx
    if (hasCalendarEvent(bookingKey(selected, slot.franja.slot))) {
      show(t('calendar.cancelReminder'), 'warn');
      clearCalendarEvent(bookingKey(selected, slot.franja.slot));
    }
```

- [ ] **Step 5: Pass `onAddCalendar` into `SlotRow`**

In the `slots.map(...)` render, change the `SlotRow` element's callbacks line:

```tsx
            onBook={() => tryBook(s)} onCancel={() => setCancelSlot(s)} onWatch={() => { setWatchSlot(s.franja.slot); setWatchOpen(true); }} />
```

to:

```tsx
            onBook={() => tryBook(s)} onCancel={() => setCancelSlot(s)} onWatch={() => { setWatchSlot(s.franja.slot); setWatchOpen(true); }}
            onAddCalendar={() => addToCalendar(s)} />
```

- [ ] **Step 6: Mount the `Toast`**

Immediately before the final closing `</div>` of the component's returned JSX (right after the `{watchOpen && <WatchSheet … />}` line), add:

```tsx
      <Toast toast={toast} />
```

- [ ] **Step 7: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/screens/SlotsScreen.tsx
git commit -m "feat(slots): add-to-calendar action + cancel reminder toast

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `MyBookingsScreen` — per-row `📅` + toast + cancel reminder

**Files:**
- Modify: `src/screens/MyBookingsScreen.tsx`

- [ ] **Step 1: Add imports**

Amend the existing bookingsDb import to also bring in `bookingKey`:

```tsx
import { listBookings, markCancelled, bookingKey, type BookingRecord } from '../lib/bookingsDb';
```

Then add these new imports below it:

```tsx
import { buildBookingEvent } from '../lib/ics';
import { addBookingToCalendar } from '../lib/calendar';
import { hasCalendarEvent, clearCalendarEvent } from '../lib/calendarEvents';
import { Toast, useToast } from '../components/Toast';
```

- [ ] **Step 2: Create the toast inside the component**

Immediately after `const { t, i18n } = useTranslation();`, add:

```tsx
  const { toast, show } = useToast();
```

- [ ] **Step 3: Add the `addToCalendar` handler**

Add this function just above `async function doCancel(`:

```tsx
  function addToCalendar(res: Reservation, franja: Franja) {
    const key = bookingKey(res.fecha, res.slot);
    const ev = buildBookingEvent(
      { fecha: res.fecha, slot: res.slot, start: franja.start, end: franja.end },
      {
        title: t('calendar.eventTitle'),
        location: t('calendar.eventLocation'),
        description: `${res.slot} · ${franja.start}–${franja.end} · ${res.nombre} · ${res.vivienda}`,
      },
    );
    try {
      if (addBookingToCalendar(ev, key, () => window.confirm(t('calendar.alreadyAddedConfirm')))) {
        show(t('calendar.added'), 'success');
      }
    } catch {
      show(t('calendar.error'), 'warn');
    }
  }
```

- [ ] **Step 4: Show the cancel reminder in `doCancel`**

In `doCancel`, after `await load(true);` and before `setCancelRow(null);`, add:

```tsx
    if (hasCalendarEvent(bookingKey(res.fecha, res.slot))) {
      show(t('calendar.cancelReminder'), 'warn');
      clearCalendarEvent(bookingKey(res.fecha, res.slot));
    }
```

- [ ] **Step 5: Add the `📅` button to each row**

In the `rows?.map(...)` render, the row currently ends with the Cancel button:

```tsx
              <button onClick={() => setCancelRow({ res, franja })}
                style={{ background: '#3a1620', color: '#ff8a8a', border: 'none', borderRadius: 10, padding: '8px 11px', fontSize: 12.5, fontWeight: 700 }}>{t('mybookings.cancel')}</button>
```

Insert a calendar button immediately BEFORE that Cancel button:

```tsx
              <button onClick={() => addToCalendar(res, franja)} aria-label="add to calendar"
                style={{ background: '#16202e', color: '#cfe0f5', border: 'none', borderRadius: 10, padding: '8px 11px', fontSize: 15, fontWeight: 700 }}>📅</button>
```

- [ ] **Step 6: Mount the `Toast`**

Immediately before the component's final closing `</div>` (right after the `{cancelRow && ( <CancelModal … /> )}` block), add:

```tsx
      <Toast toast={toast} />
```

- [ ] **Step 7: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/screens/MyBookingsScreen.tsx
git commit -m "feat(mybookings): add-to-calendar action + cancel reminder toast

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Prune calendar flags with the existing TTL sweep

**Files:**
- Modify: `src/screens/StatsScreen.tsx`

The local TTL sweep (`pruneOldBookings`, 3 months) already runs in `StatsScreen.loadLog`. Prune the calendar-flag store on the same cutoff so it stays bounded.

- [ ] **Step 1: Add the import**

After `import { dateToYmd, ymdToDate, addDays, addMonths, ymdToISO, isoToYmd } from '../lib/dates';`, add:

```tsx
import { pruneCalendarEvents } from '../lib/calendarEvents';
```

- [ ] **Step 2: Call prune alongside `pruneOldBookings`**

Change the TTL line in `loadLog` (currently):

```tsx
    try { await pruneOldBookings(addMonths(today, -TTL_MONTHS)); } catch { /* */ }   // TTL
```

to:

```tsx
    const ttlCutoff = addMonths(today, -TTL_MONTHS);
    try { await pruneOldBookings(ttlCutoff); } catch { /* */ }   // TTL
    try { pruneCalendarEvents(ttlCutoff); } catch { /* */ }       // TTL (calendar flags)
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/StatsScreen.tsx
git commit -m "chore(calendar): prune calendar flags on the TTL sweep

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — the prior 58 tests plus the new `ics.test.ts` and `calendarEvents.test.ts`.

- [ ] **Step 2: Type-check + build the PWA**

Run: `npm run build`
Expected: `tsc --noEmit` clean, then `vite build` succeeds and emits `dist/manifest.webmanifest` + `dist/sw.js`.

- [ ] **Step 3: Manual live check (deploy, then verify on device)**

Per `CLAUDE.md` "Deploy" + "Verifying changes live" (build with `VITE_VAPID_PUBLIC` + `VITE_DEVICE_SECRET`, then `npm run worker:deploy`; clear the SW + caches before checking). On **a real iPhone (installed PWA) and an Android device**:
- On the Slots screen, an own (blue "Mine") future slot shows a `📅` button next to `×`.
- Tapping `📅` opens the system "Add to Calendar" flow with the correct date/time and a 15-minute reminder.
- On **My bookings**, each row shows a `📅` button; tapping it does the same.
- Tapping `📅` again for the same booking shows the "add again?" confirm.
- Cancelling a booking you added shows the ⚠️ "delete the event manually" toast.

This step cannot be verified by unit tests (calendar hand-off is OS-level and `.ics` delivery on iOS standalone needs on-device confirmation — see the spec's "Verification" section).

---

## Notes & deviations from the spec

- The spec listed a `calendar.reminderText` key; the implementation reuses the event **title** as the `VALARM` `DESCRIPTION` instead, so that key is intentionally omitted (one fewer string to translate, same on-screen result).
- `downloadIcs` and `addBookingToCalendar` are not unit-tested because they touch `URL.createObjectURL` / DOM navigation, which jsdom does not implement. The pure logic they rely on (`buildIcs`, the flag store) is fully tested.
