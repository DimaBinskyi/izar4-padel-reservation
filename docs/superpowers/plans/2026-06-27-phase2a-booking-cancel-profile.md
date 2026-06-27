# Phase 2a — Profile, Booking & Cancellation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user fill a profile once, then **book** a free padel slot (with a confirmation modal + weekly/daily limit enforcement) and **cancel** their own booking (with per-booking code memory and the code-match fallback) — all from the app.

**Architecture:** Builds on Phase 1 (PWA + Worker proxy + slot viewing). Adds pure-logic modules (profile, limits, "mine" detection, cancel policy, stats-source booking log in IndexedDB) under TDD, write methods on the izar4 client, and three modals (Profile, Booking, Cancel) wired into `SlotsScreen`.

**Tech Stack:** Same as Phase 1, plus `idb` (IndexedDB wrapper) and `fake-indexeddb` (tests).

References: `docs/superpowers/specs/2026-06-27-padel-reservas-design.md` (§5 data model, §7 booking/cancel, §12 i18n), `docs/API.md` (§2 write endpoints, §1.8 inmuebles), `CLAUDE.md` (conventions).

---

## File structure (this phase)

```
src/lib/
  profile.ts            profile.test.ts        # localStorage profile CRUD
  limits.ts             limits.test.ts         # weekly/daily counts per vivienda
  mine.ts               mine.test.ts           # is-this-reservation-mine (vivienda+name)
  bookingsDb.ts         bookingsDb.test.ts     # IndexedDB log + per-booking code memory
  cancelPolicy.ts       cancelPolicy.test.ts   # cancel decision tree
  izar4Client.ts (modify) + new tests          # fetchInmuebles, fetchReservationCode, create, cancel
  vitest.setup.ts                              # installs fake-indexeddb for tests
src/components/
  ProfileModal.tsx       # first-run + edit (Name, Apartment autocomplete, Cancel code)
  BookingModal.tsx       # confirm a new booking (shows data used + weekly impact)
  CancelModal.tsx        # confirm cancel (remembered / code-match / ask)
src/screens/
  SlotsScreen.tsx (modify)  # profile gate, weekly chip, +/× actions wired to modals
src/i18n/locales/*.json (modify)  # new keys
```

---

## Task 1: Add deps + IndexedDB test setup

**Files:** Modify `package.json`, `vitest.config.ts`; create `src/lib/vitest.setup.ts`

- [ ] **Step 1: Install runtime + test deps**

Run: `npm install idb@^8.0.0 && npm install -D fake-indexeddb@^6.0.0`
Expected: both added to package.json.

- [ ] **Step 2: Create `src/lib/vitest.setup.ts`**

```ts
import 'fake-indexeddb/auto';
```

- [ ] **Step 3: Modify `vitest.config.ts`** to load the setup file

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/lib/vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Verify existing tests still pass**

Run: `npx vitest run`
Expected: 17 passing (unchanged).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: add idb + fake-indexeddb and vitest IndexedDB setup"
```

---

## Task 2: Profile module (TDD)

**Files:** Create `src/lib/profile.ts`, `src/lib/profile.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/profile.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadProfile, saveProfile, isProfileComplete, type Profile } from './profile';

beforeEach(() => localStorage.clear());

describe('profile', () => {
  it('returns null when nothing saved', () => {
    expect(loadProfile()).toBeNull();
  });

  it('saves and loads a profile', () => {
    const p: Profile = { nombre: 'Dmytro', vivienda: 'P3-7', codigo: 'sol24' };
    saveProfile(p);
    expect(loadProfile()).toEqual(p);
  });

  it('isProfileComplete requires all three non-empty fields', () => {
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete({ nombre: 'A', vivienda: '', codigo: 'x' })).toBe(false);
    expect(isProfileComplete({ nombre: ' ', vivienda: 'P1-1', codigo: 'x' })).toBe(false);
    expect(isProfileComplete({ nombre: 'A', vivienda: 'P1-1', codigo: 'x' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — fails**

Run: `npx vitest run src/lib/profile.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — `src/lib/profile.ts`

```ts
export interface Profile {
  nombre: string;
  vivienda: string;
  codigo: string;
}

const KEY = 'padel_profile';

export function loadProfile(): Profile | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Profile;
    return { nombre: p.nombre ?? '', vivienda: p.vivienda ?? '', codigo: p.codigo ?? '' };
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function isProfileComplete(p: Profile | null): boolean {
  return !!p && p.nombre.trim() !== '' && p.vivienda.trim() !== '' && p.codigo.trim() !== '';
}
```

- [ ] **Step 4: Run test — passes**

Run: `npx vitest run src/lib/profile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: profile module (localStorage) with tests"
```

---

## Task 3: izar4 client write/lookup methods (TDD)

**Files:** Modify `src/lib/izar4Client.ts`; create `src/lib/izar4Client.write.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/izar4Client.write.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchInmuebles, createReservation, cancelReservation, fetchReservationCode } from './izar4Client';

beforeEach(() => vi.restoreAllMocks());
function mock(data: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('izar4Client writes', () => {
  it('fetchInmuebles returns labels', async () => {
    mock({ ok: true, inmuebles: [{ label: 'P1-1' }, { label: 'P3-7' }] });
    expect(await fetchInmuebles('s')).toEqual(['P1-1', 'P3-7']);
  });

  it('createReservation posts the correct body and returns id', async () => {
    const spy = mock({ ok: true, id: 1530 });
    const res = await createReservation('s', { fecha: '20260703', slot: 'P1-1', nombre: 'Dmytro', vivienda: 'p3-7', codigo: 'sol24' });
    expect(res).toEqual({ ok: true, id: 1530 });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      titulo: '20260703 - PADEL P1-1', idFranja: 'P1-1', fecha: '20260703',
      nombre: 'Dmytro', vivienda: 'P3-7', codigo: 'sol24', idTermino: 12,
    });
    expect((init.headers as Record<string, string>)['x-device-secret']).toBe('s');
  });

  it('cancelReservation posts id + code and maps wrong-code', async () => {
    mock({ ok: false, code: 'codigo_incorrecto' });
    const r = await cancelReservation('s', 1530, 'nope');
    expect(r).toEqual({ ok: false, code: 'codigo_incorrecto' });
  });

  it('fetchReservationCode returns the cancellation code for an id', async () => {
    mock({ id: 1530, acf: { codigo_cancelacion_reservas: 'sol24' } });
    expect(await fetchReservationCode('s', 1530)).toBe('sol24');
  });
});
```

- [ ] **Step 2: Run test — fails**

Run: `npx vitest run src/lib/izar4Client.write.test.ts`
Expected: FAIL (functions undefined).

- [ ] **Step 3: Implement — append to `src/lib/izar4Client.ts`**

Add these imports/exports (keep existing code). At the top the file already imports `API_BASE, PADEL_TERM_ID` from `../config`; add `APP_API_BASE`:

Change the existing import line
```ts
import { API_BASE, PADEL_TERM_ID } from '../config';
```
to
```ts
import { API_BASE, APP_API_BASE, PADEL_TERM_ID } from '../config';
```

Then append at the end of the file:

```ts
export async function fetchInmuebles(secret: string): Promise<string[]> {
  const r = await fetch(`${APP_API_BASE}/inmuebles?tipo=vivienda`, {
    headers: { 'x-device-secret': secret }, cache: 'no-store',
  });
  const d = (await r.json()) as { ok?: boolean; inmuebles?: { label: string }[] };
  return d.ok && d.inmuebles ? d.inmuebles.map((i) => i.label) : [];
}

export interface CreateInput {
  fecha: string; slot: string; nombre: string; vivienda: string; codigo: string;
}

export async function createReservation(secret: string, input: CreateInput): Promise<{ ok: boolean; id?: number }> {
  const vivienda = input.vivienda.trim().toUpperCase();
  const body = {
    titulo: `${input.fecha} - PADEL ${input.slot}`,
    idFranja: input.slot,
    fecha: input.fecha,
    nombre: input.nombre.trim(),
    vivienda,
    codigo: input.codigo,
    idTermino: PADEL_TERM_ID,
  };
  const r = await fetch(`${APP_API_BASE}/reservar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-secret': secret },
    body: JSON.stringify(body),
  });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: number };
  return { ok: !!d.ok, id: d.id };
}

export async function cancelReservation(secret: string, idReserva: number, codigo: string): Promise<{ ok: boolean; code?: string }> {
  const r = await fetch(`${APP_API_BASE}/cancelar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-secret': secret },
    body: JSON.stringify({ idReserva, codigo }),
  });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string };
  return { ok: !!d.ok, code: d.code };
}

// Used ONLY by the cancel flow to compare against the user's own profile code.
// The value is never rendered in the UI (see spec §7.3/§14).
export async function fetchReservationCode(secret: string, idReserva: number): Promise<string> {
  const r = await fetch(`${API_BASE}/wp/v2/reservas/${idReserva}?_fields=id,acf`, {
    headers: { 'x-device-secret': secret }, cache: 'no-store',
  });
  const d = (await r.json().catch(() => ({}))) as { acf?: { codigo_cancelacion_reservas?: string } };
  return d.acf?.codigo_cancelacion_reservas ?? '';
}
```

- [ ] **Step 4: Run test — passes**

Run: `npx vitest run src/lib/izar4Client.write.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: izar4 client write methods (inmuebles, create, cancel, code lookup) with tests"
```

---

## Task 4: Limits module (TDD)

**Files:** Create `src/lib/limits.ts`, `src/lib/limits.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/limits.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { weekRange, countWeek, countDay, weeklyRemaining } from './limits';
import type { Reservation } from './types';

function res(fecha: string, vivienda: string, slot = 'P1-1'): Reservation {
  return { id: Math.random(), slot, fecha, nombre: 'x', vivienda };
}

describe('limits', () => {
  it('weekRange returns Mon..Sun containing the date', () => {
    // 20260627 is Saturday → week Mon 22 .. Sun 28 June 2026
    expect(weekRange('20260627')).toEqual({ monday: '20260622', sunday: '20260628' });
  });

  it('countWeek counts a vivienda within the date\'s week (case-insensitive)', () => {
    const all = [res('20260622', 'P3-7'), res('20260628', 'p3-7'), res('20260629', 'P3-7'), res('20260623', 'P1-1')];
    expect(countWeek(all, 'P3-7', '20260627')).toBe(2); // 22 and 28 in-week; 29 is next week
  });

  it('countDay counts a vivienda on an exact date', () => {
    const all = [res('20260627', 'P3-7', 'P1-1'), res('20260627', 'P3-7', 'P1-2'), res('20260627', 'P1-1')];
    expect(countDay(all, 'P3-7', '20260627')).toBe(2);
  });

  it('weeklyRemaining is limit minus week count, floored at 0', () => {
    const all = [res('20260622', 'P3-7'), res('20260623', 'P3-7'), res('20260624', 'P3-7')];
    expect(weeklyRemaining(all, 'P3-7', '20260627', 3)).toBe(0);
    expect(weeklyRemaining([], 'P3-7', '20260627', 3)).toBe(3);
  });
});
```

- [ ] **Step 2: Run test — fails**

Run: `npx vitest run src/lib/limits.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — `src/lib/limits.ts`

```ts
import type { Reservation } from './types';
import { ymdToDate, dateToYmd } from './dates';

export function weekRange(fechaYmd: string): { monday: string; sunday: string } {
  const d = ymdToDate(fechaYmd);
  const dow = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday: dateToYmd(monday), sunday: dateToYmd(sunday) };
}

function sameViv(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

export function countWeek(all: Reservation[], vivienda: string, fechaYmd: string): number {
  const { monday, sunday } = weekRange(fechaYmd);
  return all.filter((r) => sameViv(r.vivienda, vivienda) && r.fecha >= monday && r.fecha <= sunday).length;
}

export function countDay(all: Reservation[], vivienda: string, fechaYmd: string): number {
  return all.filter((r) => sameViv(r.vivienda, vivienda) && r.fecha === fechaYmd).length;
}

export function weeklyRemaining(all: Reservation[], vivienda: string, fechaYmd: string, limit: number): number {
  return Math.max(0, limit - countWeek(all, vivienda, fechaYmd));
}
```
(Ymd strings are zero-padded fixed-width, so lexical `>=`/`<=` equals chronological comparison.)

- [ ] **Step 4: Run test — passes**

Run: `npx vitest run src/lib/limits.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: weekly/daily limit counting per vivienda with tests"
```

---

## Task 5: "Mine" detection (TDD)

**Files:** Create `src/lib/mine.ts`, `src/lib/mine.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/mine.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { isMine } from './mine';
import type { Reservation } from './types';
import type { Profile } from './profile';

const profile: Profile = { nombre: 'Dmytro', vivienda: 'P3-7', codigo: 'sol24' };
function res(nombre: string, vivienda: string): Reservation {
  return { id: 1, slot: 'P1-1', fecha: '20260627', nombre, vivienda };
}

describe('isMine', () => {
  it('matches on vivienda + name, case/space-insensitive', () => {
    expect(isMine(res('  dmytro ', 'p3-7'), profile)).toBe(true);
  });
  it('rejects different name (same vivienda)', () => {
    expect(isMine(res('Other', 'P3-7'), profile)).toBe(false);
  });
  it('rejects different vivienda', () => {
    expect(isMine(res('Dmytro', 'P1-1'), profile)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — fails.** `npx vitest run src/lib/mine.test.ts`

- [ ] **Step 3: Implement** — `src/lib/mine.ts`

```ts
import type { Reservation } from './types';
import type { Profile } from './profile';

const norm = (s: string) => s.trim().toLowerCase();

export function isMine(r: Reservation, profile: Profile): boolean {
  return (
    r.vivienda.trim().toUpperCase() === profile.vivienda.trim().toUpperCase() &&
    norm(r.nombre) === norm(profile.nombre)
  );
}
```

- [ ] **Step 4: Run — passes (3 tests).**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 'mine' reservation detection (vivienda+name) with tests"
```

---

## Task 6: Bookings log + code memory in IndexedDB (TDD)

**Files:** Create `src/lib/bookingsDb.ts`, `src/lib/bookingsDb.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/bookingsDb.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { recordBooking, getBookingCode, markCancelled, listBookings, type BookingRecord } from './bookingsDb';

function rec(over: Partial<BookingRecord> = {}): BookingRecord {
  return {
    key: '20260627|P1-1', reservaId: 1, fecha: '20260627', slot: 'P1-1',
    start: '09:00', end: '10:00', nombre: 'Dmytro', vivienda: 'P3-7',
    codigoUsed: 'sol24', origin: 'app', status: 'active', createdAt: 1, ...over,
  };
}

beforeEach(async () => {
  indexedDB.deleteDatabase('padel');
});

describe('bookingsDb', () => {
  it('records a booking and reads its code back by date+slot', async () => {
    await recordBooking(rec());
    expect(await getBookingCode('20260627', 'P1-1')).toBe('sol24');
  });

  it('returns null code for an unknown booking', async () => {
    expect(await getBookingCode('20260101', 'P1-9')).toBeNull();
  });

  it('marks a booking cancelled and lists reflect status', async () => {
    await recordBooking(rec());
    await markCancelled('20260627', 'P1-1', 2);
    const all = await listBookings();
    expect(all[0].status).toBe('cancelled');
    expect(all[0].cancelledAt).toBe(2);
  });
});
```

- [ ] **Step 2: Run — fails.** `npx vitest run src/lib/bookingsDb.test.ts`

- [ ] **Step 3: Implement** — `src/lib/bookingsDb.ts`

```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type BookingOrigin = 'app' | 'auto' | 'izar4' | 'unknown';
export type BookingStatus = 'active' | 'cancelled';

export interface BookingRecord {
  key: string;          // `${fecha}|${slot}`
  reservaId: number;
  fecha: string;        // YYYYMMDD
  slot: string;         // e.g. P1-1
  start: string;        // HH:MM
  end: string;          // HH:MM
  nombre: string;
  vivienda: string;
  codigoUsed: string;   // the code used to create this booking
  origin: BookingOrigin;
  status: BookingStatus;
  createdAt: number;
  cancelledAt?: number;
}

interface Schema extends DBSchema {
  bookings: { key: string; value: BookingRecord };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<Schema>('padel', 1, {
      upgrade(d) { d.createObjectStore('bookings', { keyPath: 'key' }); },
    });
  }
  return dbp;
}

export function bookingKey(fecha: string, slot: string): string {
  return `${fecha}|${slot}`;
}

export async function recordBooking(r: BookingRecord): Promise<void> {
  await (await db()).put('bookings', r);
}

export async function getBookingCode(fecha: string, slot: string): Promise<string | null> {
  const r = await (await db()).get('bookings', bookingKey(fecha, slot));
  return r ? r.codigoUsed : null;
}

export async function markCancelled(fecha: string, slot: string, when: number): Promise<void> {
  const d = await db();
  const r = await d.get('bookings', bookingKey(fecha, slot));
  if (r) { r.status = 'cancelled'; r.cancelledAt = when; await d.put('bookings', r); }
}

export async function listBookings(): Promise<BookingRecord[]> {
  return (await db()).getAll('bookings');
}
```

- [ ] **Step 4: Run — passes (3 tests).** `npx vitest run src/lib/bookingsDb.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: IndexedDB bookings log + per-booking code memory with tests"
```

---

## Task 7: Cancel policy (TDD)

**Files:** Create `src/lib/cancelPolicy.ts`, `src/lib/cancelPolicy.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/cancelPolicy.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { planCancel } from './cancelPolicy';

describe('planCancel', () => {
  it('uses remembered code when present', () => {
    expect(planCancel({ rememberedCode: 'sol24', apiCode: 'whatever', profileCode: 'luna25' }))
      .toEqual({ mode: 'remembered', codigo: 'sol24' });
  });
  it('one-tap when api code equals the profile code', () => {
    expect(planCancel({ rememberedCode: null, apiCode: 'sol24', profileCode: 'sol24' }))
      .toEqual({ mode: 'codeMatch', codigo: 'sol24' });
  });
  it('asks when api code differs from profile code', () => {
    expect(planCancel({ rememberedCode: null, apiCode: 'other', profileCode: 'sol24' }))
      .toEqual({ mode: 'ask' });
  });
  it('asks when no remembered code and api code unknown', () => {
    expect(planCancel({ rememberedCode: null, apiCode: '', profileCode: 'sol24' }))
      .toEqual({ mode: 'ask' });
  });
});
```

- [ ] **Step 2: Run — fails.** `npx vitest run src/lib/cancelPolicy.test.ts`

- [ ] **Step 3: Implement** — `src/lib/cancelPolicy.ts`

```ts
export type CancelPlan =
  | { mode: 'remembered'; codigo: string }
  | { mode: 'codeMatch'; codigo: string }
  | { mode: 'ask' };

export function planCancel(opts: {
  rememberedCode: string | null;
  apiCode: string;
  profileCode: string;
}): CancelPlan {
  if (opts.rememberedCode) return { mode: 'remembered', codigo: opts.rememberedCode };
  if (opts.apiCode && opts.apiCode === opts.profileCode) {
    return { mode: 'codeMatch', codigo: opts.apiCode };
  }
  return { mode: 'ask' };
}
```

- [ ] **Step 4: Run — passes (4 tests).**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: cancel decision tree (remembered / code-match / ask) with tests"
```

---

## Task 8: i18n keys for booking/cancel/profile

**Files:** Modify `src/i18n/locales/{uk,en,ru,es}.json`

- [ ] **Step 1: Add a `booking`, `cancel`, and `profile` block to each locale.** Add these keys to the existing JSON objects (merge, don't remove existing keys).

`uk.json` — add:
```json
  "common": { "save": "Зберегти", "cancel": "Скасувати", "back": "Назад", "confirm": "Підтвердити", "edit": "Редагувати" },
  "profile": {
    "fillTitle": "Заповни профіль",
    "fillSubtitle": "Один раз — і бронюємо в один тап. Перепитаємо, лише якщо дані загубляться.",
    "editTitle": "Редагувати профіль",
    "name": "Ім'я", "apartment": "Квартира", "cancelCode": "Код скасування",
    "apartmentSearch": "Пошук… напр. P3-7", "codeHint": "🔑 Знадобиться для скасування броні.",
    "namePlaceholder": "Твоє ім'я", "codePlaceholder": "напр. sol24",
    "pickFromList": "Обери квартиру зі списку."
  },
  "booking": {
    "title": "Підтвердити бронь",
    "resource": "Ресурс", "date": "Дата", "slot": "Слот",
    "bookingAs": "Бронюю як", "afterWeekly": "Після броні: {{n}}/{{limit}} цього тижня",
    "limitReachedWeek": "Ліміт {{limit}} броней на тиждень вичерпано.",
    "limitReachedDay": "На цей день уже є бронь (1 на день).",
    "error": "Помилка бронювання. Спробуй ще раз."
  },
  "cancel": {
    "title": "Скасувати бронь?",
    "warn": "Слот знову стане вільним. Дію не можна скасувати.",
    "yours": "Твоя бронь", "codeRemembered": "🔑 Скасуємо кодом, яким бронював ✓",
    "enterCode": "Код скасування", "askCode": "Код цієї броні не збережено — введи код, яким бронював:",
    "wrongCode": "Код не підійшов. Спробуй ще раз.",
    "doCancel": "Скасувати бронь", "error": "Помилка скасування. Спробуй ще раз."
  }
```

`en.json` — add:
```json
  "common": { "save": "Save", "cancel": "Cancel", "back": "Back", "confirm": "Confirm", "edit": "Edit" },
  "profile": {
    "fillTitle": "Fill your profile",
    "fillSubtitle": "Once — then booking is one tap. We'll only re-ask if the data is lost.",
    "editTitle": "Edit profile",
    "name": "Name", "apartment": "Apartment", "cancelCode": "Cancel code",
    "apartmentSearch": "Search… e.g. P3-7", "codeHint": "🔑 You'll need it to cancel a booking.",
    "namePlaceholder": "Your name", "codePlaceholder": "e.g. sol24",
    "pickFromList": "Pick an apartment from the list."
  },
  "booking": {
    "title": "Confirm booking",
    "resource": "Resource", "date": "Date", "slot": "Slot",
    "bookingAs": "Booking as", "afterWeekly": "After booking: {{n}}/{{limit}} this week",
    "limitReachedWeek": "Weekly limit of {{limit}} bookings reached.",
    "limitReachedDay": "You already have a booking that day (1 per day).",
    "error": "Booking failed. Try again."
  },
  "cancel": {
    "title": "Cancel booking?",
    "warn": "The slot becomes free again. This cannot be undone.",
    "yours": "Your booking", "codeRemembered": "🔑 We'll cancel with the code you booked with ✓",
    "enterCode": "Cancel code", "askCode": "This booking's code isn't saved — enter the code you booked with:",
    "wrongCode": "Wrong code. Try again.",
    "doCancel": "Cancel booking", "error": "Cancellation failed. Try again."
  }
```

`ru.json` — add:
```json
  "common": { "save": "Сохранить", "cancel": "Отмена", "back": "Назад", "confirm": "Подтвердить", "edit": "Редактировать" },
  "profile": {
    "fillTitle": "Заполни профиль",
    "fillSubtitle": "Один раз — и бронируем в один тап. Переспросим, только если данные потеряются.",
    "editTitle": "Редактировать профиль",
    "name": "Имя", "apartment": "Квартира", "cancelCode": "Код отмены",
    "apartmentSearch": "Поиск… напр. P3-7", "codeHint": "🔑 Понадобится для отмены брони.",
    "namePlaceholder": "Твоё имя", "codePlaceholder": "напр. sol24",
    "pickFromList": "Выбери квартиру из списка."
  },
  "booking": {
    "title": "Подтвердить бронь",
    "resource": "Ресурс", "date": "Дата", "slot": "Слот",
    "bookingAs": "Бронирую как", "afterWeekly": "После брони: {{n}}/{{limit}} на этой неделе",
    "limitReachedWeek": "Лимит {{limit}} броней в неделю исчерпан.",
    "limitReachedDay": "На этот день уже есть бронь (1 в день).",
    "error": "Ошибка бронирования. Попробуй ещё раз."
  },
  "cancel": {
    "title": "Отменить бронь?",
    "warn": "Слот снова станет свободным. Действие необратимо.",
    "yours": "Твоя бронь", "codeRemembered": "🔑 Отменим кодом, которым бронировал ✓",
    "enterCode": "Код отмены", "askCode": "Код этой брони не сохранён — введи код, которым бронировал:",
    "wrongCode": "Код не подошёл. Попробуй ещё раз.",
    "doCancel": "Отменить бронь", "error": "Ошибка отмены. Попробуй ещё раз."
  }
```

`es.json` — add:
```json
  "common": { "save": "Guardar", "cancel": "Cancelar", "back": "Volver", "confirm": "Confirmar", "edit": "Editar" },
  "profile": {
    "fillTitle": "Completa tu perfil",
    "fillSubtitle": "Una vez — y reservar es un toque. Solo te lo pediremos otra vez si se pierden los datos.",
    "editTitle": "Editar perfil",
    "name": "Nombre", "apartment": "Vivienda", "cancelCode": "Código de cancelación",
    "apartmentSearch": "Buscar… ej. P3-7", "codeHint": "🔑 Lo necesitarás para cancelar.",
    "namePlaceholder": "Tu nombre", "codePlaceholder": "ej. sol24",
    "pickFromList": "Elige una vivienda de la lista."
  },
  "booking": {
    "title": "Confirmar reserva",
    "resource": "Recurso", "date": "Fecha", "slot": "Turno",
    "bookingAs": "Reservo como", "afterWeekly": "Tras reservar: {{n}}/{{limit}} esta semana",
    "limitReachedWeek": "Límite de {{limit}} reservas por semana alcanzado.",
    "limitReachedDay": "Ya tienes una reserva ese día (1 por día).",
    "error": "Error al reservar. Inténtalo de nuevo."
  },
  "cancel": {
    "title": "¿Cancelar reserva?",
    "warn": "El turno vuelve a quedar libre. No se puede deshacer.",
    "yours": "Tu reserva", "codeRemembered": "🔑 Cancelaremos con el código que usaste ✓",
    "enterCode": "Código de cancelación", "askCode": "El código de esta reserva no está guardado — introduce el código que usaste:",
    "wrongCode": "Código incorrecto. Inténtalo de nuevo.",
    "doCancel": "Cancelar reserva", "error": "Error al cancelar. Inténtalo de nuevo."
  }
```

- [ ] **Step 2: Verify JSON parses + tests pass**

Run: `npx vitest run`
Expected: still green (no test depends on these keys yet).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: i18n keys for profile/booking/cancel (uk/en/ru/es)"
```

---

## Task 9: ProfileModal (first-run + edit)

**Files:** Create `src/components/ProfileModal.tsx`

- [ ] **Step 1: Implement** — `src/components/ProfileModal.tsx`

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchInmuebles } from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import type { Profile } from '../lib/profile';

interface Props {
  initial: Profile | null;
  mode: 'fill' | 'edit';
  onSave: (p: Profile) => void;
  onClose?: () => void;   // only in edit mode (fill mode is mandatory)
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex',
  alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50,
};
const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 420, marginTop: 48, background: '#101826',
  border: '1px solid #243246', borderRadius: 18, padding: 16,
};
const inp: React.CSSProperties = {
  width: '100%', background: '#0b1320', border: '1px solid #243246', borderRadius: 10,
  padding: '10px 11px', fontSize: 13, color: '#eaf2fc',
};
const label: React.CSSProperties = { display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#7e92ad', margin: '4px 0 5px' };

export function ProfileModal({ initial, mode, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [vivienda, setVivienda] = useState(initial?.vivienda ?? '');
  const [codigo, setCodigo] = useState(initial?.codigo ?? '');
  const [viviendas, setViviendas] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    fetchInmuebles(getDeviceSecret()).then(setViviendas).catch(() => setViviendas([]));
  }, []);

  const matches = vivienda.trim()
    ? viviendas.filter((v) => v.toLowerCase().includes(vivienda.trim().toLowerCase())).slice(0, 8)
    : [];
  const exact = viviendas.some((v) => v.toUpperCase() === vivienda.trim().toUpperCase());
  const valid = nombre.trim() !== '' && exact && codigo.trim() !== '';

  function submit() {
    setTouched(true);
    if (!valid) return;
    onSave({ nombre: nombre.trim(), vivienda: vivienda.trim().toUpperCase(), codigo: codigo.trim() });
  }

  return (
    <div style={overlay} onClick={() => mode === 'edit' && onClose?.()}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>
          {mode === 'fill' ? t('profile.fillTitle') : t('profile.editTitle')}
        </h3>
        {mode === 'fill' && (
          <p style={{ margin: '0 0 14px', fontSize: 11.5, color: '#8aa0bd' }}>{t('profile.fillSubtitle')}</p>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={label}>{t('profile.name')}</label>
          <input style={inp} value={nombre} placeholder={t('profile.namePlaceholder')}
            onChange={(e) => setNombre(e.target.value)} />
        </div>

        <div style={{ marginBottom: 12, position: 'relative' }}>
          <label style={label}>{t('profile.apartment')}</label>
          <input style={inp} value={vivienda} placeholder={t('profile.apartmentSearch')}
            onChange={(e) => setVivienda(e.target.value)} autoCapitalize="characters" />
          {matches.length > 0 && !exact && (
            <div style={{ background: '#0b1320', border: '1px solid #243246', borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
              {matches.map((v) => (
                <div key={v} style={{ padding: '8px 11px', fontSize: 12.5, color: '#cfe0f5', cursor: 'pointer' }}
                  onClick={() => setVivienda(v)}>{v}</div>
              ))}
            </div>
          )}
          {touched && !exact && (
            <div style={{ fontSize: 11, color: '#ff9b9b', marginTop: 5 }}>{t('profile.pickFromList')}</div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>{t('profile.cancelCode')}</label>
          <input style={inp} value={codigo} placeholder={t('profile.codePlaceholder')}
            onChange={(e) => setCodigo(e.target.value)} />
          <div style={{ fontSize: 11, color: '#86b7ff', marginTop: 5 }}>{t('profile.codeHint')}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {mode === 'edit' && (
            <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }}
              onClick={() => onClose?.()}>{t('common.cancel')}</button>
          )}
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, opacity: valid ? 1 : 0.6 }}
            onClick={submit}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: ProfileModal (first-run + edit) with vivienda autocomplete"
```

---

## Task 10: BookingModal

**Files:** Create `src/components/BookingModal.tsx`

- [ ] **Step 1: Implement** — `src/components/BookingModal.tsx`

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Profile } from '../lib/profile';
import type { SlotView } from '../lib/types';
import { ymdToDate } from '../lib/dates';
import { WEEKLY_LIMIT } from '../config';

interface Props {
  slot: SlotView;
  fecha: string;
  profile: Profile;
  weeklyCountAfter: number;   // count this booking would make (current + 1)
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 };
const sheet: React.CSSProperties = { width: '100%', maxWidth: 420, background: '#101826', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: '1px solid #243246', padding: '14px 16px 18px' };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 };

export function BookingModal({ slot, fecha, profile, weeklyCountAfter, onConfirm, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = ymdToDate(fecha);
  const dateStr = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);

  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm(); } catch { setError(t('booking.error')); setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('booking.title')}</h3>
        <div style={{ background: '#0b1320', border: '1px solid #1e2a3c', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.resource')}</span><b>Pádel</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.date')}</span><b>{dateStr}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.slot')}</span><b>{slot.franja.start} – {slot.franja.end}</b></div>
        </div>
        <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#7e92ad', margin: '4px 0 6px' }}>{t('booking.bookingAs')}</div>
        <div style={{ background: '#0b1320', border: '1px solid #21304a', borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('profile.name')}</span><b>{profile.nombre}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('profile.apartment')}</span><b>{profile.vivienda}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('profile.cancelCode')}</span><b style={{ fontFamily: 'monospace' }}>{profile.codigo}</b></div>
        </div>
        <div style={{ fontSize: 12, color: '#7ee2a8', margin: '0 0 12px' }}>
          {t('booking.afterWeekly', { n: weeklyCountAfter, limit: WEEKLY_LIMIT })}
        </div>
        {error && <div style={{ fontSize: 12, color: '#ff9b9b', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }} onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, opacity: busy ? 0.6 : 1 }} onClick={go} disabled={busy}>{t('common.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` — no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: BookingModal (confirm with profile data + weekly impact)"
```

---

## Task 11: CancelModal

**Files:** Create `src/components/CancelModal.tsx`

- [ ] **Step 1: Implement** — `src/components/CancelModal.tsx`

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlotView } from '../lib/types';
import type { Profile } from '../lib/profile';
import { ymdToDate } from '../lib/dates';
import { getBookingCode } from '../lib/bookingsDb';
import { fetchReservationCode } from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { planCancel, type CancelPlan } from '../lib/cancelPolicy';

interface Props {
  slot: SlotView;        // must have slot.reservation
  fecha: string;
  profile: Profile;
  onConfirm: (codigo: string) => Promise<boolean>;  // returns false on wrong code
  onClose: () => void;
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 };
const sheet: React.CSSProperties = { width: '100%', maxWidth: 420, background: '#101826', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: '1px solid #243246', padding: '14px 16px 18px' };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 };

export function CancelModal({ slot, fecha, profile, onConfirm, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [plan, setPlan] = useState<CancelPlan | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = ymdToDate(fecha);
  const dateStr = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);

  useEffect(() => {
    (async () => {
      const remembered = await getBookingCode(fecha, slot.franja.slot);
      let apiCode = '';
      if (!remembered) apiCode = await fetchReservationCode(getDeviceSecret(), slot.reservation!.id).catch(() => '');
      setPlan(planCancel({ rememberedCode: remembered, apiCode, profileCode: profile.codigo }));
    })();
  }, [fecha, slot, profile.codigo]);

  async function go() {
    if (!plan) return;
    const codigo = plan.mode === 'ask' ? typed.trim() : plan.codigo;
    if (!codigo) { setError(t('cancel.wrongCode')); return; }
    setBusy(true); setError(null);
    try {
      const ok = await onConfirm(codigo);
      if (!ok) { setError(t('cancel.wrongCode')); setBusy(false); }
    } catch { setError(t('cancel.error')); setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{t('cancel.title')}</h3>
        <div style={{ fontSize: 12, color: '#ffb4b4', background: '#241316', border: '1px solid #4a2129', borderRadius: 9, padding: '8px 10px', marginBottom: 12 }}>{t('cancel.warn')}</div>
        <div style={{ background: '#0b1320', border: '1px solid #1e2a3c', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.date')}</span><b>{dateStr}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.slot')}</span><b>{slot.franja.start} – {slot.franja.end}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('cancel.yours')}</span><b>{profile.nombre} · {profile.vivienda}</b></div>
        </div>
        {plan && plan.mode !== 'ask' && (
          <div style={{ fontSize: 12, color: '#7ee2a8', background: '#0e2018', border: '1px solid #234e34', borderRadius: 9, padding: '8px 10px', marginBottom: 12 }}>{t('cancel.codeRemembered')}</div>
        )}
        {plan && plan.mode === 'ask' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, color: '#8aa0bd', marginBottom: 6 }}>{t('cancel.askCode')}</div>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('cancel.enterCode')}
              style={{ width: '100%', background: '#0a1018', border: '1px solid #243246', borderRadius: 9, padding: '9px 11px', fontSize: 13, color: '#eaf2fc', fontFamily: 'monospace' }} />
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: '#ff9b9b', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }} onClick={onClose} disabled={busy}>{t('common.back')}</button>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#b3261e', color: '#fff', fontWeight: 700, opacity: busy || !plan ? 0.6 : 1 }} onClick={go} disabled={busy || !plan}>{t('cancel.doCancel')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` — no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: CancelModal (remembered / code-match / ask flows)"
```

---

## Task 12: Wire SlotsScreen (profile gate, weekly chip, +/× actions)

**Files:** Modify `src/screens/SlotsScreen.tsx`; modify `src/components/SlotRow.tsx`

- [ ] **Step 1: Modify `src/components/SlotRow.tsx`** to render an action button and "Mine" badge.

Replace the whole file with:

```tsx
import { useTranslation } from 'react-i18next';
import type { SlotView } from '../lib/types';

const BADGE: Record<string, { bg: string; fg: string }> = {
  libre: { bg: '#10261a', fg: '#7ee2a8' },
  ocupado: { bg: '#2a1414', fg: '#ff9b9b' },
  bloqueado: { bg: '#1a1a1a', fg: '#7a7a7a' },
  pasado: { bg: '#1a1a1a', fg: '#7a7a7a' },
  pronto: { bg: '#241a00', fg: '#f2c14e' },
  mine: { bg: '#101a2b', fg: '#86b7ff' },
};

interface Props {
  slot: SlotView;
  mine: boolean;          // this occupied slot belongs to the user
  onBook: () => void;     // for free slots
  onCancel: () => void;   // for own slots
}

export function SlotRow({ slot, mine, onBook, onCancel }: Props) {
  const { t } = useTranslation();
  const badgeKey = mine && slot.status === 'ocupado' ? 'mine' : slot.status;
  const c = BADGE[badgeKey];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 8px', borderBottom: '1px solid #141d2a' }}>
      <div style={{ width: 96, fontSize: 12.5, fontWeight: 600 }}>{slot.franja.start}–{slot.franja.end}</div>
      <div style={{ width: 78 }}>
        <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.fg }}>
          {t(`status.${badgeKey}`)}
        </span>
      </div>
      <div style={{ flex: 1, fontSize: 12 }}>
        {slot.reservation && (
          <>
            <div style={{ color: '#dce8f7' }}>{slot.reservation.nombre}</div>
            <div style={{ color: '#8aa0bd', fontSize: 10.5 }}>{slot.reservation.vivienda}</div>
          </>
        )}
      </div>
      <div style={{ width: 34 }}>
        {slot.status === 'libre' && (
          <button onClick={onBook} aria-label="book"
            style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: '#1d4ed8', color: '#fff', fontSize: 17, fontWeight: 700 }}>+</button>
        )}
        {slot.status === 'ocupado' && mine && (
          <button onClick={onCancel} aria-label="cancel"
            style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: '#3a1620', color: '#ff8a8a', fontSize: 17, fontWeight: 700 }}>×</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/screens/SlotsScreen.tsx`** with the wired version

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateStrip } from '../components/DateStrip';
import { SlotRow } from '../components/SlotRow';
import { ProfileModal } from '../components/ProfileModal';
import { BookingModal } from '../components/BookingModal';
import { CancelModal } from '../components/CancelModal';
import { deriveSlots } from '../lib/status';
import {
  fetchFranjas, fetchReservations, fetchAllReservations, fetchWeekdayBlocks, fetchDayBlock,
  createReservation, cancelReservation,
} from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { dateToYmd } from '../lib/dates';
import { loadProfile, saveProfile, isProfileComplete, type Profile } from '../lib/profile';
import { isMine } from '../lib/mine';
import { countDay, weeklyRemaining, countWeek } from '../lib/limits';
import { recordBooking, markCancelled, bookingKey } from '../lib/bookingsDb';
import { WEEKLY_LIMIT, DAILY_LIMIT } from '../config';
import type { Reservation, SlotView } from '../lib/types';

export function SlotsScreen() {
  const { t } = useTranslation();
  const today = dateToYmd(new Date());
  const [selected, setSelected] = useState(today);
  const [slots, setSlots] = useState<SlotView[] | null>(null);
  const [allRes, setAllRes] = useState<Reservation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(loadProfile());
  const [editingProfile, setEditingProfile] = useState(false);
  const [bookSlot, setBookSlot] = useState<SlotView | null>(null);
  const [cancelSlot, setCancelSlot] = useState<SlotView | null>(null);

  const secret = getDeviceSecret();
  const needProfile = !isProfileComplete(profile);

  const load = useCallback(async () => {
    setSlots(null); setError(null); setBlockedMsg(null);
    try {
      const [franjas, reservations, allReservations, weekdayBlocks, dayBlock] = await Promise.all([
        fetchFranjas(secret),
        fetchReservations(secret, selected),
        fetchAllReservations(secret),
        fetchWeekdayBlocks(secret),
        fetchDayBlock(secret, selected),
      ]);
      setAllRes(allReservations);
      if (dayBlock) { setBlockedMsg(dayBlock.motivo || t('slots.dayBlocked')); setSlots([]); return; }
      setSlots(deriveSlots({ fecha: selected, franjas, reservations, weekdayBlocks, dayBlocked: false, now: new Date() }));
    } catch { setError(t('slots.error')); }
  }, [secret, selected, t]);

  useEffect(() => { void load(); }, [load]);

  const remaining = profile ? weeklyRemaining(allRes, profile.vivienda, selected, WEEKLY_LIMIT) : WEEKLY_LIMIT;

  async function doBook(slot: SlotView) {
    if (!profile) return;
    const r = await createReservation(secret, {
      fecha: selected, slot: slot.franja.slot, nombre: profile.nombre, vivienda: profile.vivienda, codigo: profile.codigo,
    });
    if (!r.ok) throw new Error('book failed');
    await recordBooking({
      key: bookingKey(selected, slot.franja.slot), reservaId: r.id ?? 0, fecha: selected, slot: slot.franja.slot,
      start: slot.franja.start, end: slot.franja.end, nombre: profile.nombre, vivienda: profile.vivienda.toUpperCase(),
      codigoUsed: profile.codigo, origin: 'app', status: 'active', createdAt: Date.now(),
    });
    setBookSlot(null);
    await load();
  }

  async function doCancel(slot: SlotView, codigo: string): Promise<boolean> {
    const id = slot.reservation!.id;
    const r = await cancelReservation(secret, id, codigo);
    if (!r.ok) return false;
    await markCancelled(selected, slot.franja.slot, Date.now());
    setCancelSlot(null);
    await load();
    return true;
  }

  function tryBook(slot: SlotView) {
    if (!profile) { setEditingProfile(true); return; }
    if (countDay(allRes, profile.vivienda, selected) >= DAILY_LIMIT) { alert(t('booking.limitReachedDay')); return; }
    if (countWeek(allRes, profile.vivienda, selected) >= WEEKLY_LIMIT) { alert(t('booking.limitReachedWeek', { limit: WEEKLY_LIMIT })); return; }
    setBookSlot(slot);
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
        <span style={{ width: 30 }} />
        <span style={{ fontSize: 17, fontWeight: 700 }}>{t('app.title')}</span>
        <button aria-label="profile" onClick={() => setEditingProfile(true)}
          style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: '#16202e', color: '#cfe0f5' }}>⚙️</button>
      </header>

      {profile && (
        <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
          <span style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 20, background: '#10261a', color: '#7ee2a8' }}>
            {remaining}/{WEEKLY_LIMIT}
          </span>
          <span style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 20, background: '#101a2b', color: '#86b7ff' }}>
            {profile.vivienda} · {profile.nombre}
          </span>
        </div>
      )}

      <DateStrip todayYmd={today} selected={selected} onSelect={setSelected} />

      <div style={{ padding: '2px 10px 8px' }}>
        {error && <div style={{ padding: 16, color: '#ff9b9b' }}>{error}</div>}
        {blockedMsg && <div style={{ padding: 16, color: '#f2c14e' }}>{blockedMsg}</div>}
        {!error && !blockedMsg && slots === null && <div style={{ padding: 16, color: '#8aa0bd' }}>{t('slots.loading')}</div>}
        {slots?.map((s) => (
          <SlotRow key={s.franja.slot} slot={s}
            mine={!!(s.reservation && profile && isMine(s.reservation, profile))}
            onBook={() => tryBook(s)} onCancel={() => setCancelSlot(s)} />
        ))}
      </div>

      {(needProfile || editingProfile) && (
        <ProfileModal initial={profile} mode={needProfile ? 'fill' : 'edit'}
          onSave={(p) => { saveProfile(p); setProfile(p); setEditingProfile(false); }}
          onClose={needProfile ? undefined : () => setEditingProfile(false)} />
      )}
      {bookSlot && profile && (
        <BookingModal slot={bookSlot} fecha={selected} profile={profile}
          weeklyCountAfter={countWeek(allRes, profile.vivienda, selected) + 1}
          onConfirm={() => doBook(bookSlot)} onClose={() => setBookSlot(null)} />
      )}
      {cancelSlot && profile && cancelSlot.reservation && (
        <CancelModal slot={cancelSlot} fecha={selected} profile={profile}
          onConfirm={(codigo) => doCancel(cancelSlot, codigo)} onClose={() => setCancelSlot(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `fetchAllReservations` to `src/lib/izar4Client.ts`** (used for limit counts).

Append:
```ts
export async function fetchAllReservations(secret: string): Promise<Reservation[]> {
  const r = await get(`/wp/v2/reservas?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,slug,acf`, secret);
  const data = (await r.json()) as any[];
  return data
    .filter((x) => x.acf && x.acf.fecha_reservas)
    .map((x) => ({
      id: Number(x.id),
      slot: x.acf.id_franja_reservas,
      fecha: normalizeYmd(x.acf.fecha_reservas),
      nombre: x.acf.nombre_reservas ?? '',
      vivienda: x.acf.vivienda_reservas ?? '',
    }));
}
```

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit` (no errors) and `npx vitest run` (all prior tests still pass).

- [ ] **Step 4: Manual smoke test (two terminals)**

Run A: `npm run worker:dev`. Run B devtools: `localStorage.setItem('padel_device_secret','dev-local-secret')`. Run C: `npm run dev`.
Expected: first load shows the profile modal; after saving, the weekly chip shows; "+" on a free slot opens BookingModal → Confirm books it (slot becomes "Mine"); "×" cancels it. (Use a test apartment/code; cancel anything you create.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire booking + cancellation into SlotsScreen (profile gate, limits, modals)"
```

---

## Self-Review

**Spec coverage (Phase 2a):**
- Profile fill-once + re-prompt + edit ✓ (Tasks 2, 9, 12). Apartment autocomplete from inmuebles ✓ (Task 3/9).
- Booking with confirmation modal showing data used + weekly impact ✓ (Task 10/12). Limits 3/week + 1/day per vivienda enforced before booking ✓ (Tasks 4, 12).
- Cancellation own-only with per-booking code memory + code-match fallback + ask ✓ (Tasks 6, 7, 11, 12). Never displays others' codes (code only used for compare/POST) ✓.
- "Mine" by vivienda+name ✓ (Task 5). Optimistic reload after write (read-after-write handled by `load()` cache-busting fetches) ✓.
- i18n keys for all new UI, uk default ✓ (Task 8).
- **Deferred to 2b/3:** My-bookings screen, stats, install banner, nav tab bar, watch/auto-grab (🎯), notification settings.

**Placeholder scan:** None. `alert()` is used for the two limit messages (simple, intentional for 2a; can become inline toasts in 2b) — not a placeholder.

**Type consistency:** `Profile`, `BookingRecord`, `CancelPlan`, `Reservation`, `SlotView` used consistently. `createReservation`/`cancelReservation`/`fetchReservationCode`/`fetchAllReservations` signatures match their call sites in `SlotsScreen`. `bookingKey(fecha, slot)` used for both record and lookup. `SlotRow` new props (`mine`, `onBook`, `onCancel`) match its single call site.

**Note for 2b:** introduce a tab/nav shell and move `alert()` limit messages to inline UI; add My-bookings (origin badges) + Stats (period selector) + InstallBanner.

---

## Post-review fixes (applied after final review)

Three fixes landed after the final code review (all verified: `tsc` clean, 38 tests, build OK):

1. **21-day horizon enforced at booking** (was a plan omission vs spec §7.1). `SlotsScreen` computes
   `beyondHorizon = selected > addDays(today, BOOKING_HORIZON_DAYS)`, passes `canBook={!beyondHorizon}`
   to `SlotRow` (hides `+` beyond the horizon), and `tryBook` early-returns with
   `t('slots.viewOnlyBeyondHorizon')` as a guard. `SlotRow` gained a `canBook: boolean` prop.
2. **Optimistic UI + delayed reconcile** for izar4 read-after-write lag. `doBook`/`doCancel` update
   `slots`/`allRes` immediately, then `load(true)` (new silent param — skips the loading flash)
   runs after 2000 ms to reconcile.
3. **Ask-mode cancel field prefilled** with the user's own profile code (`CancelModal` initial
   `typed = profile.codigo`), per spec §7.3.
