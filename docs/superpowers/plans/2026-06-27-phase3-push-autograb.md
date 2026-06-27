# Phase 3 — Push Notifications & Auto-Grab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Web Push (works on closed iOS 16.4+ PWA) when a padel slot frees up, plus **auto-grab** of freed slots from a date+slot-range watchlist — driven by a Cloudflare Worker cron that polls izar4, diffs, grabs, and pushes; with a permission-gating flow and a notification-settings screen.

**Architecture:** A custom service worker (`injectManifest`) handles `push`/`notificationclick`. The client subscribes via `PushManager` and registers `{subscription, profile, watchlist, prefs}` to the Worker (`/subscribe`, KV). The Worker's **cron** (every minute; acts on a 2-min day / 10-min night cadence) fetches padel reservations over the 21-day horizon, diffs vs the KV snapshot, runs **pure decision logic** (`worker/logic.ts`, TDD), auto-grabs eligible freed slots (respecting 3/week + 1/day, disabling watches on limit, expiring past watches), and sends Web Push via `@block65/webcrypto-web-push`. Grabbed bookings sync back to the device into its local code map (origin `auto`).

**Tech Stack:** + `@block65/webcrypto-web-push` (Worker push sending), `web-push` (devDep, VAPID keygen only). VAPID keypair. Cloudflare KV + Cron Triggers.

> **Runtime validation:** push delivery + cron require deployment (`wrangler login`, secrets, KV). Local checks cover pure logic (TDD), typecheck, and build. The final manual test is on a real phone after deploy.

References: spec §8 (auto-grab, past-slot/expiry), §9 (notifications, quiet hours, self-suppress), §10 (permission gating), §11 (Worker logic), §5.2 (KV); `docs/API.md` (§2 writes); `CLAUDE.md`.

---

## File structure (this phase)

```
worker/
  logic.ts         logic.test.ts     # pure cron decision logic (diff/grab/notify/expiry/limits) — TDD
  push.ts                            # web-push send wrapper (@block65)
  index.ts (modify)                  # + /subscribe, /vapid, /pull-grabbed, scheduled() cron
  wrangler.toml (modify)             # KV binding, cron trigger, vars
src/
  sw.ts                              # custom service worker: push + notificationclick (injectManifest)
  lib/push.ts        push.test.ts    # urlBase64ToUint8Array (TDD) + subscribe/permission helpers
  lib/notifPrefs.ts  notifPrefs.test.ts  # prefs model (localStorage) + quiet-hours/self-suppress (TDD)
  lib/watchlist.ts   watchlist.test.ts   # watch model (localStorage) + range expansion (TDD)
  lib/syncGrabbed.ts                 # pull grabbed bookings → bookingsDb (origin 'auto')
  components/NotifGate.tsx           # permission states A/B/C + recheck on focus
  components/WatchSheet.tsx          # create watch (date + slot range + preview) + active watches
  screens/SettingsScreen.tsx (modify)   # notifications section (toggles, quiet hours)
  screens/SlotsScreen.tsx (modify)      # 🎯 on busy slots → add to watch; "Watch" section entry
  config.ts (modify)                 # VITE_VAPID_PUBLIC, WORKER_BASE
  vite.config.ts (modify)            # injectManifest strategy
  i18n/locales/*.json (modify)
```

---

## Task 1: Deps, VAPID keys, env wiring

**Files:** Modify `package.json`, `src/config.ts`, `wrangler.toml`; create `.env.example`

- [ ] **Step 1: Install deps**

Run: `npm install @block65/webcrypto-web-push && npm install -D web-push`

- [ ] **Step 2: Generate a VAPID keypair**

Run: `npx web-push generate-vapid-keys --json`
Save the output. Example shape: `{"publicKey":"BAp, "privateKey":"..."}`. The **publicKey** is shipped to the client; the **privateKey** is a Worker secret.

- [ ] **Step 3: Add client env wiring** — `src/config.ts` (append)

```ts
// Web Push: the VAPID public key is injected at build time (VITE_VAPID_PUBLIC).
export const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC ?? '';
// Base for Worker endpoints. Same-origin in production (Worker serves the PWA); empty = relative.
export const WORKER_BASE = import.meta.env.VITE_WORKER_BASE ?? '';
```

- [ ] **Step 4: Create `.env.example`**

```
VITE_VAPID_PUBLIC=<your vapid public key>
VITE_WORKER_BASE=
```
(Add real `.env` locally; it is already gitignored.)

- [ ] **Step 5: Update `wrangler.toml`** — KV binding + cron + vars

```toml
name = "izar4-padel"
main = "worker/index.ts"
compatibility_date = "2024-09-01"

assets = { directory = "./dist", binding = "ASSETS" }

[[kv_namespaces]]
binding = "KV"
id = "REPLACE_WITH_KV_ID"          # set after `wrangler kv namespace create padel-kv`

[triggers]
crons = ["* * * * *"]              # runs every minute; handler decides 2-min/10-min cadence

[vars]
VAPID_PUBLIC = "REPLACE_WITH_PUBLIC"
VAPID_SUBJECT = "mailto:dima@koolzone.com"
# VAPID_PRIVATE + DEVICE_SECRET are secrets: `wrangler secret put VAPID_PRIVATE` etc.
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: add web-push deps, VAPID/env wiring, KV+cron in wrangler.toml"
```

---

## Task 2: Worker pure decision logic (TDD)

**Files:** Create `worker/logic.ts`, `worker/logic.test.ts`

These are pure functions the cron uses. Keys are `"<fecha>|<slot>"`.

- [ ] **Step 1: Write the failing test** — `worker/logic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { diffSnapshots, slotStartPassed, weekRange, countWeekKeys, chooseGrab, isWatchExpired } from './logic';

describe('worker logic', () => {
  it('diffSnapshots returns freed and added keys', () => {
    const prev = ['20260628|P1-1', '20260628|P1-2'];
    const curr = ['20260628|P1-2', '20260629|P1-1'];
    expect(diffSnapshots(prev, curr)).toEqual({ freed: ['20260628|P1-1'], added: ['20260629|P1-1'] });
  });

  it('slotStartPassed is true only for today when start <= now', () => {
    const franjas = { 'P1-1': { start: '09:00' }, 'P1-9': { start: '20:30' } };
    const now = new Date(2026, 5, 28, 10, 0); // 28 Jun 10:00
    expect(slotStartPassed('20260628', 'P1-1', franjas, now)).toBe(true);   // 09:00 passed today
    expect(slotStartPassed('20260628', 'P1-9', franjas, now)).toBe(false);  // 20:30 upcoming today
    expect(slotStartPassed('20260629', 'P1-1', franjas, now)).toBe(false);  // future day
    expect(slotStartPassed('20260627', 'P1-1', franjas, now)).toBe(true);   // past day
  });

  it('weekRange + countWeekKeys count a vivienda within the week', () => {
    const wr = weekRange('20260628'); // Sun 28 Jun → Mon22..Sun28
    expect(wr).toEqual({ monday: '20260622', sunday: '20260628' });
    const reservas = [
      { fecha: '20260622', slot: 'P1-1', vivienda: 'P3-7' },
      { fecha: '20260628', slot: 'P1-2', vivienda: 'p3-7' },
      { fecha: '20260629', slot: 'P1-3', vivienda: 'P3-7' },
    ];
    expect(countWeekKeys(reservas, 'P3-7', '20260628')).toBe(2);
  });

  it('chooseGrab returns the first eligible freed slot in the watch range under limits', () => {
    const watch = { fecha: '20260628', franjas: ['P1-7', 'P1-8', 'P1-9'], active: true };
    const freed = ['20260628|P1-8', '20260628|P1-9'];
    const franjas = { 'P1-7': { start: '17:30' }, 'P1-8': { start: '19:00' }, 'P1-9': { start: '20:30' } };
    const now = new Date(2026, 5, 28, 12, 0);
    const got = chooseGrab(watch, freed, { franjas, now, weekCount: 0, dayCount: 0, weeklyLimit: 3, dailyLimit: 1 });
    expect(got).toBe('P1-8'); // first in franja order that is freed + future + within limits
  });

  it('chooseGrab returns null when daily limit already reached', () => {
    const watch = { fecha: '20260628', franjas: ['P1-8'], active: true };
    const got = chooseGrab(watch, ['20260628|P1-8'], { franjas: { 'P1-8': { start: '19:00' } }, now: new Date(2026,5,28,12,0), weekCount: 0, dayCount: 1, weeklyLimit: 3, dailyLimit: 1 });
    expect(got).toBeNull();
  });

  it('chooseGrab skips a freed slot whose start already passed', () => {
    const watch = { fecha: '20260628', franjas: ['P1-1', 'P1-9'], active: true };
    const got = chooseGrab(watch, ['20260628|P1-1', '20260628|P1-9'], { franjas: { 'P1-1': { start: '09:00' }, 'P1-9': { start: '20:30' } }, now: new Date(2026,5,28,10,0), weekCount: 0, dayCount: 0, weeklyLimit: 3, dailyLimit: 1 });
    expect(got).toBe('P1-9'); // P1-1 09:00 passed → skipped
  });

  it('isWatchExpired when all franjas have passed/older than today', () => {
    const franjas = { 'P1-1': { start: '09:00' }, 'P1-2': { start: '10:00' } };
    const now = new Date(2026, 5, 28, 11, 0);
    expect(isWatchExpired({ fecha: '20260628', franjas: ['P1-1', 'P1-2'], active: true }, franjas, now)).toBe(true);  // both passed today
    expect(isWatchExpired({ fecha: '20260628', franjas: ['P1-1', 'P1-9'], active: true }, { ...franjas, 'P1-9': { start: '20:30' } }, now)).toBe(false); // P1-9 still future
    expect(isWatchExpired({ fecha: '20260627', franjas: ['P1-9'], active: true }, { 'P1-9': { start: '20:30' } }, now)).toBe(true); // past day
  });
});
```

- [ ] **Step 2: Run — fails.** `npx vitest run worker/logic.test.ts`

- [ ] **Step 3: Implement** — `worker/logic.ts`

```ts
export interface Watch { fecha: string; franjas: string[]; active: boolean }
export interface FranjaTime { start: string }
export type FranjaMap = Record<string, FranjaTime>;

export function diffSnapshots(prev: string[], curr: string[]): { freed: string[]; added: string[] } {
  const prevSet = new Set(prev);
  const currSet = new Set(curr);
  return {
    freed: prev.filter((k) => !currSet.has(k)),
    added: curr.filter((k) => !prevSet.has(k)),
  };
}

function ymdToParts(ymd: string) {
  return { y: +ymd.slice(0, 4), m: +ymd.slice(4, 6), d: +ymd.slice(6, 8) };
}
function toMidnight(ymd: string): number {
  const { y, m, d } = ymdToParts(ymd);
  return new Date(y, m - 1, d).getTime();
}
function startMinutes(hhmm: string): number {
  const [h, mi] = hhmm.split(':').map(Number);
  return h * 60 + mi;
}

export function slotStartPassed(fecha: string, slot: string, franjas: FranjaMap, now: Date): boolean {
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMid = toMidnight(fecha);
  if (dayMid < todayMid) return true;            // past day
  if (dayMid > todayMid) return false;           // future day
  const f = franjas[slot];
  if (!f) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= startMinutes(f.start);        // today: passed if start <= now
}

function dateToYmd(d: Date): string {
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

export function weekRange(fechaYmd: string): { monday: string; sunday: string } {
  const { y, m, d } = ymdToParts(fechaYmd);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const monday = new Date(date); monday.setDate(date.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { monday: dateToYmd(monday), sunday: dateToYmd(sunday) };
}

export function countWeekKeys(
  reservas: { fecha: string; vivienda: string }[], vivienda: string, fechaYmd: string,
): number {
  const { monday, sunday } = weekRange(fechaYmd);
  const v = vivienda.trim().toUpperCase();
  return reservas.filter((r) => r.vivienda.trim().toUpperCase() === v && r.fecha >= monday && r.fecha <= sunday).length;
}

export interface GrabCtx {
  franjas: FranjaMap; now: Date;
  weekCount: number; dayCount: number; weeklyLimit: number; dailyLimit: number;
}

export function chooseGrab(watch: Watch, freedKeys: string[], ctx: GrabCtx): string | null {
  if (!watch.active) return null;
  if (ctx.dayCount >= ctx.dailyLimit) return null;
  if (ctx.weekCount >= ctx.weeklyLimit) return null;
  const freedSet = new Set(freedKeys);
  for (const slot of watch.franjas) {
    const key = `${watch.fecha}|${slot}`;
    if (!freedSet.has(key)) continue;
    if (slotStartPassed(watch.fecha, slot, ctx.franjas, ctx.now)) continue;
    return slot;
  }
  return null;
}

export function isWatchExpired(watch: Watch, franjas: FranjaMap, now: Date): boolean {
  return watch.franjas.every((slot) => slotStartPassed(watch.fecha, slot, franjas, now));
}
```

- [ ] **Step 4: Run — passes (7 tests).** `npx vitest run worker/logic.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: worker cron decision logic (diff/past-slot/limits/grab/expiry) with tests"
```

---

## Task 3: Client push helpers (TDD) + subscribe/permission

**Files:** Create `src/lib/push.ts`, `src/lib/push.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/push.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array, permissionState } from './push';

describe('push helpers', () => {
  it('urlBase64ToUint8Array decodes a VAPID key to the right length', () => {
    // A 65-byte P-256 public key is base64url ~88 chars. Use a known short value.
    const out = urlBase64ToUint8Array('AAAA'); // 3 bytes of zero
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(3);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it('permissionState maps Notification.permission + standalone', () => {
    expect(permissionState({ supported: false, standalone: false, permission: 'default' })).toBe('unsupported');
    expect(permissionState({ supported: true, standalone: false, permission: 'default' })).toBe('not-installed');
    expect(permissionState({ supported: true, standalone: true, permission: 'default' })).toBe('prompt');
    expect(permissionState({ supported: true, standalone: true, permission: 'granted' })).toBe('granted');
    expect(permissionState({ supported: true, standalone: true, permission: 'denied' })).toBe('denied');
  });
});
```

- [ ] **Step 2: Run — fails.** `npx vitest run src/lib/push.test.ts`

- [ ] **Step 3: Implement** — `src/lib/push.ts`

```ts
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PermState = 'unsupported' | 'not-installed' | 'prompt' | 'granted' | 'denied';

export function permissionState(env: {
  supported: boolean; standalone: boolean; permission: NotificationPermission;
}): PermState {
  if (!env.supported) return 'unsupported';
  if (!env.standalone) return 'not-installed';
  if (env.permission === 'granted') return 'granted';
  if (env.permission === 'denied') return 'denied';
  return 'prompt';
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function currentPermState(): PermState {
  return permissionState({
    supported: pushSupported(),
    standalone: isStandalone(),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
  });
}
```

- [ ] **Step 4: Run — passes (2 tests).**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: client push helpers (base64 decode, permission state) with tests"
```

---

## Task 4: Notification prefs model (TDD)

**Files:** Create `src/lib/notifPrefs.ts`, `src/lib/notifPrefs.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/notifPrefs.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPrefs, savePrefs, defaultPrefs, isQuietNow } from './notifPrefs';

beforeEach(() => localStorage.clear());

describe('notifPrefs', () => {
  it('defaults: master on, all types on, self-suppress on, quiet off', () => {
    const p = defaultPrefs();
    expect(p.master).toBe(true);
    expect(p.types.freed && p.types.grabbed && p.types.limitOff && p.types.watchExpired && p.types.myCancelled).toBe(true);
    expect(p.suppressSelf).toBe(true);
    expect(p.quiet.enabled).toBe(false);
  });

  it('saves and loads', () => {
    const p = defaultPrefs(); p.types.freed = false;
    savePrefs(p);
    expect(loadPrefs().types.freed).toBe(false);
  });

  it('isQuietNow respects an enabled window 00:00–07:00', () => {
    const p = defaultPrefs(); p.quiet = { enabled: true, from: '00:00', to: '07:00', nightAllowed: { grabbed: true, freed: false, limitOff: false, watchExpired: false, myCancelled: false } };
    expect(isQuietNow(p, new Date(2026, 5, 28, 3, 0))).toBe(true);   // 03:00 inside
    expect(isQuietNow(p, new Date(2026, 5, 28, 9, 0))).toBe(false);  // 09:00 outside
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement** — `src/lib/notifPrefs.ts`

```ts
export type NotifType = 'freed' | 'grabbed' | 'limitOff' | 'watchExpired' | 'myCancelled';

export interface NotifPrefs {
  master: boolean;
  types: Record<NotifType, boolean>;
  suppressSelf: boolean;
  quiet: { enabled: boolean; from: string; to: string; nightAllowed: Record<NotifType, boolean> };
}

const KEY = 'padel_notif_prefs';

export function defaultPrefs(): NotifPrefs {
  return {
    master: true,
    types: { freed: true, grabbed: true, limitOff: true, watchExpired: true, myCancelled: true },
    suppressSelf: true,
    quiet: { enabled: false, from: '00:00', to: '07:00',
      nightAllowed: { freed: false, grabbed: true, limitOff: false, watchExpired: false, myCancelled: false } },
  };
}

export function loadPrefs(): NotifPrefs {
  const raw = localStorage.getItem(KEY);
  if (!raw) return defaultPrefs();
  try { return { ...defaultPrefs(), ...JSON.parse(raw) } as NotifPrefs; } catch { return defaultPrefs(); }
}

export function savePrefs(p: NotifPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

function toMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

export function isQuietNow(p: NotifPrefs, now: Date): boolean {
  if (!p.quiet.enabled) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = toMin(p.quiet.from); const to = toMin(p.quiet.to);
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to; // handles wrap past midnight
}
```

- [ ] **Step 4: Run — passes (3 tests).**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: notification prefs model (+quiet hours) with tests"
```

---

## Task 5: Watchlist model (TDD)

**Files:** Create `src/lib/watchlist.ts`, `src/lib/watchlist.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/watchlist.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadWatches, addWatch, removeWatch, expandRange, type Watch } from './watchlist';
import type { Franja } from './types';

const franjas: Franja[] = [
  { id: 1, slot: 'P1-6', start: '16:00', end: '17:30', order: 6 },
  { id: 2, slot: 'P1-7', start: '17:30', end: '19:00', order: 7 },
  { id: 3, slot: 'P1-8', start: '19:00', end: '20:30', order: 8 },
  { id: 4, slot: 'P1-9', start: '20:30', end: '22:00', order: 9 },
];

beforeEach(() => localStorage.clear());

describe('watchlist', () => {
  it('expandRange returns the contiguous slots between from and to (inclusive, by order)', () => {
    expect(expandRange(franjas, 'P1-7', 'P1-9')).toEqual(['P1-7', 'P1-8', 'P1-9']);
    expect(expandRange(franjas, 'P1-9', 'P1-7')).toEqual(['P1-7', 'P1-8', 'P1-9']); // order-normalized
    expect(expandRange(franjas, 'P1-6', 'P1-6')).toEqual(['P1-6']);
  });

  it('add/remove/load round-trip', () => {
    const w: Watch = { fecha: '20260628', franjas: ['P1-7', 'P1-8'], active: true };
    addWatch(w);
    expect(loadWatches()).toHaveLength(1);
    removeWatch('20260628');
    expect(loadWatches()).toHaveLength(0);
  });

  it('addWatch replaces an existing watch for the same date', () => {
    addWatch({ fecha: '20260628', franjas: ['P1-7'], active: true });
    addWatch({ fecha: '20260628', franjas: ['P1-8', 'P1-9'], active: true });
    const all = loadWatches();
    expect(all).toHaveLength(1);
    expect(all[0].franjas).toEqual(['P1-8', 'P1-9']);
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement** — `src/lib/watchlist.ts`

```ts
import type { Franja } from './types';

export interface Watch { fecha: string; franjas: string[]; active: boolean }

const KEY = 'padel_watchlist';

export function expandRange(franjas: Franja[], from: string, to: string): string[] {
  const sorted = [...franjas].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((f) => f.slot === from);
  const j = sorted.findIndex((f) => f.slot === to);
  if (i === -1 || j === -1) return [];
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  return sorted.slice(lo, hi + 1).map((f) => f.slot);
}

export function loadWatches(): Watch[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as Watch[]; } catch { return []; }
}

export function saveWatches(w: Watch[]): void {
  localStorage.setItem(KEY, JSON.stringify(w));
}

export function addWatch(w: Watch): void {
  const all = loadWatches().filter((x) => x.fecha !== w.fecha);
  all.push(w);
  saveWatches(all);
}

export function removeWatch(fecha: string): void {
  saveWatches(loadWatches().filter((x) => x.fecha !== fecha));
}
```

- [ ] **Step 4: Run — passes (3 tests).**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: watchlist model (range expansion + persistence) with tests"
```

---

## Task 6: Custom service worker (push + notificationclick) via injectManifest

**Files:** Create `src/sw.ts`; modify `vite.config.ts`, `src/main.tsx`

- [ ] **Step 1: Create `src/sw.ts`**

```ts
/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string } = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* ignore */ }
  const title = data.title ?? 'Pádel';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) { if ('focus' in c) { void (c as WindowClient).focus(); return; } }
      return self.clients.openWindow(url);
    }),
  );
});
```

- [ ] **Step 2: Install workbox-precaching** (used by the custom SW)

Run: `npm install -D workbox-precaching`

- [ ] **Step 3: Modify `vite.config.ts`** — switch to injectManifest

Replace the `VitePWA({...})` call with:
```ts
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: { swSrc: 'src/sw.ts', swDest: 'dist/sw.js' },
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Pádel Reservas', short_name: 'Pádel', lang: 'uk',
        theme_color: '#0b0f17', background_color: '#0b0f17', display: 'standalone', start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
```
(`registerSW` in `main.tsx` stays the same — `autoUpdate` still applies with injectManifest.)

- [ ] **Step 4: Build to verify SW compiles**

Run: `npm run build`
Expected: success; `dist/sw.js` present and contains the push handler (injectManifest bundles `src/sw.ts`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: custom service worker (push + notificationclick) via injectManifest"
```

---

## Task 7: Worker push send + endpoints + cron

**Files:** Create `worker/push.ts`; modify `worker/index.ts`

- [ ] **Step 1: Create `worker/push.ts`**

```ts
import { buildPushPayload } from '@block65/webcrypto-web-push';

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
export interface Vapid { subject: string; publicKey: string; privateKey: string }

export async function sendPush(sub: PushSub, payload: object, vapid: Vapid): Promise<boolean> {
  try {
    const req = await buildPushPayload(
      { data: JSON.stringify(payload), options: { ttl: 600 } },
      sub,
      vapid,
    );
    const res = await fetch(sub.endpoint, req);
    return res.ok || res.status === 201;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Modify `worker/index.ts`** — add Env fields, endpoints, and `scheduled`

Replace the `Env` interface and add the new routes + cron. Full new `worker/index.ts`:

```ts
import { diffSnapshots, chooseGrab, isWatchExpired, countWeekKeys, type Watch, type FranjaMap } from './logic';
import { sendPush, type PushSub, type Vapid } from './push';

export interface Env {
  DEVICE_SECRET: string;
  VAPID_PUBLIC: string;
  VAPID_PRIVATE: string;
  VAPID_SUBJECT: string;
  KV: KVNamespace;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

const IZAR4 = 'https://izar4.es';
const TERM = 12;
const HORIZON_DAYS = 21;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-device-secret',
};

interface DeviceRecord {
  subscription: PushSub;
  profile: { nombre: string; vivienda: string; codigo: string };
  watches: Watch[];
  prefs: { master: boolean; types: Record<string, boolean>; suppressSelf: boolean;
           quiet: { enabled: boolean; from: string; to: string; nightAllowed: Record<string, boolean> } };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (req.headers.get('x-device-secret') !== env.DEVICE_SECRET) return json({ error: 'unauthorized' }, 401);

      // app endpoints handled by the worker (not proxied)
      if (url.pathname === '/api/vapid') return json({ publicKey: env.VAPID_PUBLIC });

      if (url.pathname === '/api/subscribe' && req.method === 'POST') {
        const deviceId = url.searchParams.get('device') ?? '';
        if (!deviceId) return json({ ok: false, error: 'no device' }, 400);
        const body = (await req.json()) as DeviceRecord;
        await env.KV.put(`device:${deviceId}`, JSON.stringify(body));
        return json({ ok: true });
      }

      if (url.pathname === '/api/pull-grabbed' && req.method === 'GET') {
        const deviceId = url.searchParams.get('device') ?? '';
        const raw = await env.KV.get(`grabbed:${deviceId}`);
        if (raw) await env.KV.delete(`grabbed:${deviceId}`);
        return json({ grabbed: raw ? JSON.parse(raw) : [] });
      }

      // default: transparent proxy to izar4
      const target = IZAR4 + url.pathname.replace(/^\/api/, '') + url.search;
      const upstream = await fetch(target, {
        method: req.method,
        headers: { 'content-type': req.headers.get('content-type') ?? 'application/json' },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      });
      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      ['content-encoding', 'content-length', 'transfer-encoding', 'content-range', 'set-cookie'].forEach((h) => headers.delete(h));
      headers.set('cache-control', 'no-store');
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();
    const night = hour < 7;                       // 00:00–07:00
    const due = night ? minute % 10 === 0 : minute % 2 === 0;
    if (!due) return;
    await runPoll(env, now);
  },
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } });
}

async function runPoll(env: Env, now: Date): Promise<void> {
  // 1. fetch franjas (times) + reservations across the horizon
  const franjasRaw = await (await fetch(`${IZAR4}/wp-json/wp/v2/franjas?per_page=100&recurso=${TERM}&_fields=id,title,acf`, { cache: 'no-store' })).json() as any[];
  const franjas: FranjaMap = {};
  for (const f of franjasRaw) franjas[f.title?.rendered ?? ''] = { start: (f.acf?.hora_inicio_franjas ?? '00:00').slice(0, 5) };

  const reservasRaw = await (await fetch(`${IZAR4}/wp-json/wp/v2/reservas?per_page=100&recurso=${TERM}&_fields=id,acf`, { cache: 'no-store' })).json() as any[];
  const reservas = reservasRaw.filter((r) => r.acf).map((r) => ({
    fecha: String(r.acf.fecha_reservas).replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3$2$1'),
    slot: r.acf.id_franja_reservas, vivienda: r.acf.vivienda_reservas ?? '',
  }));
  const occupied = reservas.map((r) => `${r.fecha}|${r.slot}`);

  // 2. diff vs snapshot
  const prevRaw = await env.KV.get('snapshot');
  const prev: string[] = prevRaw ? JSON.parse(prevRaw) : [];
  const { freed } = diffSnapshots(prev, occupied);
  await env.KV.put('snapshot', JSON.stringify(occupied));
  if (prev.length === 0) return; // first run: just seed the snapshot, no notifications

  const todayYmd = dateToYmd(now);
  const horizonYmd = addDaysYmd(todayYmd, HORIZON_DAYS);
  const weekFreed = freed.filter((k) => { const d = k.split('|')[0]; return d >= todayYmd && d <= addDaysYmd(todayYmd, 7); });

  // 3. per device
  const list = await env.KV.list({ prefix: 'device:' });
  const vapid: Vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE };

  for (const k of list.keys) {
    const rec = JSON.parse((await env.KV.get(k.name))!) as DeviceRecord;
    if (!rec.prefs?.master) continue;
    const deviceId = k.name.slice('device:'.length);
    let changed = false;
    const grabbedOut: any[] = [];

    // 3a. auto-grab on active watches
    for (const watch of rec.watches.filter((w) => w.active)) {
      if (isWatchExpired(watch, franjas, now)) { watch.active = false; changed = true;
        await maybePush(rec, 'watchExpired', { title: 'Pádel', body: `Ловля ${watch.fecha} истекла`, url: '/' }, env, vapid, now); continue; }
      const weekCount = countWeekKeys(reservas, rec.profile.vivienda, watch.fecha);
      const dayCount = reservas.filter((r) => r.vivienda.trim().toUpperCase() === rec.profile.vivienda.trim().toUpperCase() && r.fecha === watch.fecha).length;
      const slot = chooseGrab(watch, freed, { franjas, now, weekCount, dayCount, weeklyLimit: 3, dailyLimit: 1 });
      if (!slot) {
        if (weekCount >= 3) { watch.active = false; changed = true;
          await maybePush(rec, 'limitOff', { title: 'Pádel', body: 'Авто-перехват выключен: лимит 3/нед', url: '/' }, env, vapid, now); }
        continue;
      }
      const ok = await createReservation(rec.profile, watch.fecha, slot);
      if (ok.ok) {
        watch.active = false; changed = true;
        grabbedOut.push({ fecha: watch.fecha, slot, id: ok.id, codigo: rec.profile.codigo, start: franjas[slot]?.start ?? '' });
        await maybePush(rec, 'grabbed', { title: '🎯 Pádel', body: `Перехватил слот ${franjas[slot]?.start ?? ''} ${watch.fecha}`, url: '/' }, env, vapid, now);
      }
    }

    // 3b. generic freed-slot notifications (next 7 days), excluding auto-grabbed-by-this-device
    if (rec.prefs.types.freed) {
      for (const key of weekFreed) {
        const [fecha, slot] = key.split('|');
        if (grabbedOut.some((g) => g.fecha === fecha && g.slot === slot)) continue;
        await maybePush(rec, 'freed', { title: '🆓 Pádel', body: `Освободился слот ${franjas[slot]?.start ?? ''} ${fecha}`, url: '/' }, env, vapid, now);
      }
    }

    if (grabbedOut.length) {
      const existingRaw = await env.KV.get(`grabbed:${deviceId}`);
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      await env.KV.put(`grabbed:${deviceId}`, JSON.stringify([...existing, ...grabbedOut]));
    }
    if (changed) await env.KV.put(k.name, JSON.stringify(rec));
  }
}

async function maybePush(rec: DeviceRecord, type: string, payload: object, env: Env, vapid: Vapid, now: Date): Promise<void> {
  if (!rec.prefs.types[type]) return;
  if (rec.prefs.quiet?.enabled) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const from = toMin(rec.prefs.quiet.from); const to = toMin(rec.prefs.quiet.to);
    const inQuiet = from <= to ? cur >= from && cur < to : cur >= from || cur < to;
    if (inQuiet && !rec.prefs.quiet.nightAllowed?.[type]) return;
  }
  await sendPush(rec.subscription, payload, vapid);
}

async function createReservation(profile: { nombre: string; vivienda: string; codigo: string }, fecha: string, slot: string): Promise<{ ok: boolean; id?: number }> {
  const body = { titulo: `${fecha} - PADEL ${slot}`, idFranja: slot, fecha, nombre: profile.nombre, vivienda: profile.vivienda.toUpperCase(), codigo: profile.codigo, idTermino: TERM };
  const r = await fetch(`${IZAR4}/wp-json/app/v1/reservar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: number };
  return { ok: !!d.ok, id: d.id };
}

function dateToYmd(d: Date): string {
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)); d.setDate(d.getDate() + days);
  return dateToYmd(d);
}
```

- [ ] **Step 3: Update `worker/index.test.ts`** — the existing 5 tests still pass since `Env` gained fields but the proxy path is unchanged. Add the new fields to the test `ENV` object so types line up:

In `worker/index.test.ts`, change the `ENV` definition to:
```ts
const ENV = { DEVICE_SECRET: 's3cret', VAPID_PUBLIC: 'p', VAPID_PRIVATE: 'k', VAPID_SUBJECT: 'mailto:x', KV: {} as any, ASSETS: { fetch: async () => new Response('asset') } } as any;
```

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit` (clean — you may need `@cloudflare/workers-types`; if `KVNamespace`/`ScheduledController` are unknown types, install `npm i -D @cloudflare/workers-types` and add `"types": ["vitest/globals", "@cloudflare/workers-types"]` to tsconfig). Then `npx vitest run` (worker proxy tests still pass; logic tests pass).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: worker push send + /subscribe /vapid /pull-grabbed + cron poll/diff/grab/notify"
```

---

## Task 8: Client — push subscription + grabbed sync + NotifGate

**Files:** Create `src/lib/pushClient.ts`, `src/lib/syncGrabbed.ts`, `src/components/NotifGate.tsx`; modify `src/App.tsx`

- [ ] **Step 1: Create `src/lib/pushClient.ts`**

```ts
import { urlBase64ToUint8Array } from './push';
import { getDeviceSecret } from './deviceSecret';
import { WORKER_BASE } from '../config';
import { loadProfile } from './profile';
import { loadWatches } from './watchlist';
import { loadPrefs } from './notifPrefs';

function deviceId(): string { return getDeviceSecret(); }

async function getVapidPublic(): Promise<string> {
  const r = await fetch(`${WORKER_BASE}/api/vapid`, { headers: { 'x-device-secret': getDeviceSecret() } });
  const d = (await r.json()) as { publicKey: string };
  return d.publicKey;
}

export async function enablePush(): Promise<boolean> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const pub = await getVapidPublic();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pub) });
  await syncRegistration(sub);
  return true;
}

export async function syncRegistration(sub?: PushSubscription): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const subscription = sub ?? (await reg.pushManager.getSubscription());
  const profile = loadProfile();
  if (!subscription || !profile) return;
  await fetch(`${WORKER_BASE}/api/subscribe?device=${encodeURIComponent(deviceId())}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-secret': getDeviceSecret() },
    body: JSON.stringify({ subscription: subscription.toJSON(), profile, watches: loadWatches(), prefs: loadPrefs() }),
  });
}
```

- [ ] **Step 2: Create `src/lib/syncGrabbed.ts`**

```ts
import { getDeviceSecret } from './deviceSecret';
import { WORKER_BASE } from '../config';
import { recordBooking, bookingKey } from './bookingsDb';

export async function pullGrabbed(): Promise<number> {
  const r = await fetch(`${WORKER_BASE}/api/pull-grabbed?device=${encodeURIComponent(getDeviceSecret())}`, {
    headers: { 'x-device-secret': getDeviceSecret() }, cache: 'no-store',
  });
  const d = (await r.json().catch(() => ({ grabbed: [] }))) as { grabbed: { fecha: string; slot: string; id: number; codigo: string; start: string }[] };
  for (const g of d.grabbed) {
    await recordBooking({
      key: bookingKey(g.fecha, g.slot), reservaId: g.id, fecha: g.fecha, slot: g.slot,
      start: g.start, end: '', nombre: '', vivienda: '', codigoUsed: g.codigo, origin: 'auto',
      status: 'active', createdAt: Date.now(),
    });
  }
  return d.grabbed.length;
}
```

- [ ] **Step 3: Create `src/components/NotifGate.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentPermState, type PermState } from '../lib/push';
import { enablePush } from '../lib/pushClient';

export function NotifGate({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<PermState>(currentPermState());

  useEffect(() => {
    const recheck = () => setState(currentPermState());
    document.addEventListener('visibilitychange', recheck);
    return () => document.removeEventListener('visibilitychange', recheck);
  }, []);

  async function enable() {
    const ok = await enablePush();
    setState(currentPermState());
    if (ok) onClose();
  }

  const box: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 };
  const card: React.CSSProperties = { maxWidth: 320, width: '100%', background: '#101826', border: '1px solid #243246', borderRadius: 18, padding: 18, textAlign: 'center' };
  const btn: React.CSSProperties = { width: '100%', padding: '12px 0', borderRadius: 11, border: 'none', fontWeight: 700, fontSize: 14 };

  return (
    <div style={box} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        {state === 'not-installed' && (<>
          <h3>{t('notif.installTitle')}</h3><p style={{ color: '#9fb3cf', fontSize: 13 }}>{t('notif.installBody')}</p>
          <button style={{ ...btn, background: '#16202e', color: '#cfe0f5' }} onClick={onClose}>{t('common.back')}</button>
        </>)}
        {state === 'prompt' && (<>
          <h3>{t('notif.enableTitle')}</h3><p style={{ color: '#9fb3cf', fontSize: 13 }}>{t('notif.enableBody')}</p>
          <button style={{ ...btn, background: '#1d4ed8', color: '#fff', marginBottom: 8 }} onClick={enable}>{t('notif.enableCta')}</button>
          <button style={{ ...btn, background: '#16202e', color: '#cfe0f5' }} onClick={onClose}>{t('install.later')}</button>
        </>)}
        {state === 'denied' && (<>
          <h3>{t('notif.deniedTitle')}</h3><p style={{ color: '#ffb4b4', fontSize: 13 }}>{t('notif.deniedBody')}</p>
          <button style={{ ...btn, background: '#1d4ed8', color: '#fff' }} onClick={() => setState(currentPermState())}>{t('notif.recheck')}</button>
        </>)}
        {(state === 'granted' || state === 'unsupported') && (<>
          <h3>{state === 'granted' ? t('notif.onTitle') : t('notif.unsupportedTitle')}</h3>
          <button style={{ ...btn, background: '#16202e', color: '#cfe0f5' }} onClick={onClose}>{t('common.back')}</button>
        </>)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Modify `src/App.tsx`** — pull grabbed bookings on focus/load

Add near the top of the `App` component body:
```tsx
  useEffect(() => {
    const sync = () => { void import('./lib/syncGrabbed').then((m) => m.pullGrabbed()).catch(() => {}); };
    sync();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  }, []);
```
(Add `import { useEffect } from 'react';` to the existing React import.)

- [ ] **Step 5: Typecheck + build.** `npx tsc --noEmit` (clean), `npm run build` (success).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: client push subscription, grabbed-sync, NotifGate permission flow"
```

---

## Task 9: Notification settings UI + i18n

**Files:** Modify `src/screens/SettingsScreen.tsx`, `src/i18n/locales/*.json`

- [ ] **Step 1: Add i18n keys (`notif` + settings additions) to each locale.** (Merge.)

`uk.json`:
```json
  "notif": {
    "section": "Сповіщення", "master": "Усі сповіщення", "freed": "🆓 Звільнився слот",
    "grabbed": "🎯 Перехопив за тебе", "limitOff": "⛔ Авто-перехоплення вимкнено",
    "watchExpired": "⌛ Ловля минула", "myCancelled": "❌ Скасували мою бронь",
    "suppressSelf": "Не сповіщати про мої дії", "quiet": "Тихі години", "quietWindow": "Вікно",
    "nightAllowed": "Що слати вночі",
    "installTitle": "Додай на екран «Початок»", "installBody": "На iPhone сповіщення працюють лише у встановленому застосунку.",
    "enableTitle": "Увімкнути сповіщення", "enableBody": "Щоб ловити звільнені корти й знати про авто-перехоплення.",
    "enableCta": "Увімкнути", "deniedTitle": "Сповіщення вимкнено", "deniedBody": "Увімкни їх у Налаштуваннях телефону → застосунок → Сповіщення.",
    "recheck": "Перевірити ще раз", "onTitle": "Сповіщення увімкнено ✓", "unsupportedTitle": "Пристрій не підтримує web-push" }
```

`en.json`:
```json
  "notif": {
    "section": "Notifications", "master": "All notifications", "freed": "🆓 Slot freed",
    "grabbed": "🎯 Grabbed for you", "limitOff": "⛔ Auto-grab disabled",
    "watchExpired": "⌛ Watch expired", "myCancelled": "❌ My booking cancelled",
    "suppressSelf": "Don't notify my own actions", "quiet": "Quiet hours", "quietWindow": "Window",
    "nightAllowed": "Allowed at night",
    "installTitle": "Add to Home Screen", "installBody": "On iPhone, notifications only work in the installed app.",
    "enableTitle": "Enable notifications", "enableBody": "To catch freed courts and auto-grab results.",
    "enableCta": "Enable", "deniedTitle": "Notifications are off", "deniedBody": "Turn them on in phone Settings → app → Notifications.",
    "recheck": "Check again", "onTitle": "Notifications on ✓", "unsupportedTitle": "This device doesn't support web push" }
```

`ru.json`:
```json
  "notif": {
    "section": "Уведомления", "master": "Все уведомления", "freed": "🆓 Освободился слот",
    "grabbed": "🎯 Перехватил за тебя", "limitOff": "⛔ Авто-перехват выключен",
    "watchExpired": "⌛ Ловля истекла", "myCancelled": "❌ Отменили мою бронь",
    "suppressSelf": "Не уведомлять о моих действиях", "quiet": "Тихие часы", "quietWindow": "Окно",
    "nightAllowed": "Что слать ночью",
    "installTitle": "Добавь на экран «Домой»", "installBody": "На iPhone уведомления работают только в установленном приложении.",
    "enableTitle": "Включить уведомления", "enableBody": "Чтобы ловить освободившиеся корты и знать об авто-перехвате.",
    "enableCta": "Включить", "deniedTitle": "Уведомления выключены", "deniedBody": "Включи их в Настройках телефона → приложение → Уведомления.",
    "recheck": "Проверить снова", "onTitle": "Уведомления включены ✓", "unsupportedTitle": "Устройство не поддерживает web-push" }
```

`es.json`:
```json
  "notif": {
    "section": "Notificaciones", "master": "Todas las notificaciones", "freed": "🆓 Turno libre",
    "grabbed": "🎯 Capturado para ti", "limitOff": "⛔ Captura automática desactivada",
    "watchExpired": "⌛ Captura expirada", "myCancelled": "❌ Cancelaron mi reserva",
    "suppressSelf": "No avisar de mis acciones", "quiet": "Horas de silencio", "quietWindow": "Ventana",
    "nightAllowed": "Permitido de noche",
    "installTitle": "Añade a pantalla de inicio", "installBody": "En iPhone las notificaciones solo funcionan en la app instalada.",
    "enableTitle": "Activar notificaciones", "enableBody": "Para capturar pistas libres y ver capturas automáticas.",
    "enableCta": "Activar", "deniedTitle": "Notificaciones desactivadas", "deniedBody": "Actívalas en Ajustes del teléfono → app → Notificaciones.",
    "recheck": "Comprobar de nuevo", "onTitle": "Notificaciones activas ✓", "unsupportedTitle": "Este dispositivo no admite web push" }
```

- [ ] **Step 2: Add the Notifications section to `SettingsScreen.tsx`.** Import prefs + NotifGate + syncRegistration, add state, and render toggles. Insert a new block after the Language group (keep existing groups). Add at the top of the component:

```tsx
  const [prefs, setPrefs] = useState(loadPrefs());
  const [gateOpen, setGateOpen] = useState(false);
  function update(p: NotifPrefs) { setPrefs(p); savePrefs(p); void syncRegistration(); }
  const toggle = (on: boolean) => (
    <span style={{ width: 38, height: 22, borderRadius: 20, background: on ? '#1d4ed8' : '#33415a', position: 'relative', flex: '0 0 auto' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff' }} />
    </span>
  );
```
Add imports: `import { loadPrefs, savePrefs, type NotifPrefs, type NotifType } from '../lib/notifPrefs';`, `import { syncRegistration } from '../lib/pushClient';`, `import { NotifGate } from '../components/NotifGate';`, `import { currentPermState } from '../lib/push';`.

Then render (after the Language `</div>` group):
```tsx
      <div style={label}>{t('notif.section')}</div>
      <div style={group}>
        <div style={item} onClick={() => { if (currentPermState() !== 'granted') setGateOpen(true); else update({ ...prefs, master: !prefs.master }); }}>
          <span>{t('notif.master')}</span>{toggle(prefs.master && currentPermState() === 'granted')}
        </div>
        {(['freed','grabbed','limitOff','watchExpired','myCancelled'] as NotifType[]).map((ty) => (
          <div key={ty} style={item} onClick={() => update({ ...prefs, types: { ...prefs.types, [ty]: !prefs.types[ty] } })}>
            <span>{t(`notif.${ty}`)}</span>{toggle(prefs.types[ty])}
          </div>
        ))}
        <div style={{ ...item, borderBottom: 'none' }} onClick={() => update({ ...prefs, suppressSelf: !prefs.suppressSelf })}>
          <span>{t('notif.suppressSelf')}</span>{toggle(prefs.suppressSelf)}
        </div>
      </div>

      <div style={label}>{t('notif.quiet')}</div>
      <div style={group}>
        <div style={item} onClick={() => update({ ...prefs, quiet: { ...prefs.quiet, enabled: !prefs.quiet.enabled } })}>
          <span>{t('notif.quiet')}</span>{toggle(prefs.quiet.enabled)}
        </div>
        {prefs.quiet.enabled && (
          <div style={{ ...item, borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#7e92ad' }}>{t('notif.nightAllowed')}</div>
            {(['grabbed','freed','myCancelled'] as NotifType[]).map((ty) => (
              <div key={ty} style={{ display: 'flex', justifyContent: 'space-between' }} onClick={() => update({ ...prefs, quiet: { ...prefs.quiet, nightAllowed: { ...prefs.quiet.nightAllowed, [ty]: !prefs.quiet.nightAllowed[ty] } } })}>
                <span style={{ fontSize: 12.5, color: '#bcd3f3' }}>{t(`notif.${ty}`)}</span>{toggle(prefs.quiet.nightAllowed[ty])}
              </div>
            ))}
          </div>
        )}
      </div>
      {gateOpen && <NotifGate onClose={() => { setGateOpen(false); setPrefs(loadPrefs()); }} />}
```
(Add `import { useState } from 'react';` already present.)

- [ ] **Step 3: Typecheck + build.** `npx tsc --noEmit`, `npm run build`, verify locales parse.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: notification settings UI (toggles, quiet hours, gate) + i18n"
```

---

## Task 10: Watch UI on Slots (🎯 + range sheet + active watches)

**Files:** Create `src/components/WatchSheet.tsx`; modify `src/components/SlotRow.tsx`, `src/screens/SlotsScreen.tsx`; i18n

- [ ] **Step 1: Add i18n keys (`watch`) to each locale.** (Merge.)

`uk`: `"watch": { "title": "Ловлю", "newTitle": "Нова ловля", "from": "Від", "to": "До", "preview": "Ловитиму {{n}} слотів:", "add": "Додати в ловлю", "active": "Активні ловлі", "none": "Немає активних ловль", "remove": "Прибрати", "watchSlot": "Ловити" }`
`en`: `"watch": { "title": "Watch", "newTitle": "New watch", "from": "From", "to": "To", "preview": "Will catch {{n}} slots:", "add": "Add watch", "active": "Active watches", "none": "No active watches", "remove": "Remove", "watchSlot": "Watch" }`
`ru`: `"watch": { "title": "Ловлю", "newTitle": "Новая ловля", "from": "От", "to": "До", "preview": "Буду ловить {{n}} слотов:", "add": "Добавить в ловлю", "active": "Активные ловли", "none": "Нет активных ловль", "remove": "Убрать", "watchSlot": "Ловить" }`
`es`: `"watch": { "title": "Captura", "newTitle": "Nueva captura", "from": "Desde", "to": "Hasta", "preview": "Capturaré {{n}} turnos:", "add": "Añadir captura", "active": "Capturas activas", "none": "Sin capturas activas", "remove": "Quitar", "watchSlot": "Capturar" }`

- [ ] **Step 2: Create `src/components/WatchSheet.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Franja } from '../lib/types';
import { expandRange, loadWatches, addWatch, removeWatch, type Watch } from '../lib/watchlist';
import { syncRegistration } from '../lib/pushClient';

export function WatchSheet({ fecha, franjas, onClose }: { fecha: string; franjas: Franja[]; onClose: () => void }) {
  const { t } = useTranslation();
  const ordered = useMemo(() => [...franjas].sort((a, b) => a.order - b.order), [franjas]);
  const [from, setFrom] = useState(ordered[0]?.slot ?? '');
  const [to, setTo] = useState(ordered[ordered.length - 1]?.slot ?? '');
  const [watches, setWatches] = useState<Watch[]>(loadWatches());
  const preview = expandRange(ordered, from, to);

  function save() {
    addWatch({ fecha, franjas: preview, active: true });
    setWatches(loadWatches());
    void syncRegistration();
  }
  function drop(f: string) { removeWatch(f); setWatches(loadWatches()); void syncRegistration(); }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 };
  const sheet: React.CSSProperties = { width: '100%', maxWidth: 420, background: '#101826', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '14px 16px 18px' };
  const sel: React.CSSProperties = { flex: 1, background: '#0b1320', border: '1px solid #243246', borderRadius: 10, padding: '9px 11px', color: '#eaf2fc' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px' }}>{t('watch.newTitle')} · {fecha}</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <select style={sel} value={from} onChange={(e) => setFrom(e.target.value)}>
            {ordered.map((f) => <option key={f.slot} value={f.slot}>{f.start}</option>)}
          </select>
          <select style={sel} value={to} onChange={(e) => setTo(e.target.value)}>
            {ordered.map((f) => <option key={f.slot} value={f.slot}>{f.end}</option>)}
          </select>
        </div>
        <div style={{ background: '#0b1320', border: '1px dashed #2a4d36', borderRadius: 10, padding: '10px 11px', marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#7ee2a8', marginBottom: 6 }}>{t('watch.preview', { n: preview.length })}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {preview.map((s) => {
              const f = ordered.find((x) => x.slot === s)!;
              return <span key={s} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 8, background: '#13261b', color: '#a7e8c1' }}>{f.start}–{f.end}</span>;
            })}
          </div>
        </div>
        <button onClick={save} style={{ width: '100%', padding: '11px 0', borderRadius: 11, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, marginBottom: 14 }}>＋ {t('watch.add')}</button>

        <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#7e92ad', marginBottom: 8 }}>{t('watch.active')}</div>
        {watches.length === 0 && <div style={{ fontSize: 12, color: '#8aa0bd' }}>{t('watch.none')}</div>}
        {watches.map((w) => (
          <div key={w.fecha} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #141d2a' }}>
            <div style={{ flex: 1, fontSize: 12.5 }}>{w.fecha} · {w.franjas.length} · {w.active ? '🟢' : '⚪'}</div>
            <button onClick={() => drop(w.fecha)} style={{ border: 'none', background: '#16202e', color: '#8aa0bd', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>🗑</button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Modify `SlotRow.tsx`** — add a 🎯 button on busy (not-mine) slots

In `Props` add `onWatch: () => void;`. In the action cell, after the cancel button block add:
```tsx
        {slot.status === 'ocupado' && !mine && (
          <button onClick={onWatch} aria-label="watch"
            style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid #4a3a12', background: '#221a06', color: '#f2c14e', fontSize: 15 }}>🎯</button>
        )}
```
Update the destructure: `export function SlotRow({ slot, mine, canBook, onBook, onCancel, onWatch }: Props) {`.

- [ ] **Step 4: Modify `SlotsScreen.tsx`** — wire WatchSheet

- Add import: `import { WatchSheet } from '../components/WatchSheet';` and a state `const [watchOpen, setWatchOpen] = useState(false);` and keep the franjas around (store them): add `const [franjas, setFranjas] = useState<Franja[]>([]);` and in `load` after fetching, `setFranjas(franjasFetched);` (rename the destructured `franjas` from the Promise.all to `franjasFetched` and set state). Import `Franja` type.
- Pass `onWatch={() => setWatchOpen(true)}` to `SlotRow`.
- Add a header button "🎯 {t('watch.title')}" that opens the sheet (so the watch UI is reachable from Slots — see spec nav decision). Render at the end:
```tsx
      {watchOpen && <WatchSheet fecha={selected} franjas={franjas} onClose={() => setWatchOpen(false)} />}
```

Exact `load` change: where the plan's Phase-1 SlotsScreen does `const [franjas, reservations, ...] = await Promise.all([...])`, rename to `franjasFetched` and add `setFranjas(franjasFetched);` plus use `franjasFetched` in the `deriveSlots` call.

- [ ] **Step 5: Typecheck + build + tests.** `npx tsc --noEmit`, `npx vitest run` (logic/watchlist/prefs/push tests included), `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: watch UI (🎯 on busy slots, range sheet with preview, active watches) + i18n"
```

---

## Task 11: Deploy (manual — requires your Cloudflare login)

**Files:** none (operational).

- [ ] **Step 1:** `npx wrangler login`
- [ ] **Step 2:** `npx wrangler kv namespace create padel-kv` → put the returned id into `wrangler.toml` `[[kv_namespaces]] id`.
- [ ] **Step 3:** Set secrets: `npx wrangler secret put DEVICE_SECRET`, `npx wrangler secret put VAPID_PRIVATE`. Put the VAPID public key into `wrangler.toml` `[vars] VAPID_PUBLIC` and build the client with `VITE_VAPID_PUBLIC=<public> npm run build`.
- [ ] **Step 4:** `npm run build && npm run worker:deploy`.
- [ ] **Step 5:** On the phone: open the `*.workers.dev` URL, Add to Home Screen, open it, set the device secret to match (Phase 3 wires `/subscribe`; ensure the client `x-device-secret` equals the Worker's `DEVICE_SECRET` — for a single personal user, set `DEVICE_SECRET` to the value the client generates, or relax the secret check to a shared constant). Enable notifications in Settings, create a watch, and verify a push arrives when a slot frees.

> **Single-user device-secret note:** the client auto-generates a per-device secret (`getDeviceSecret`) but the Worker checks one shared `DEVICE_SECRET`. For your personal multi-feature use, the simplest is to set `DEVICE_SECRET` to a known value and have the client use it (store that value in `localStorage['padel_device_secret']` once on your devices), so the `device=` KV key is stable per device while the header secret matches. A future enhancement: switch the header gate to verify any registered device id.

---

## Self-Review

**Spec coverage (Phase 3):**
- Web Push (VAPID) from Worker, closed-app iOS ✓ Tasks 1,6,7,8.
- Cron 2-min day / 10-min night ✓ Task 7 `scheduled`.
- Diff freed slots; generic "freed" push next 7 days; past-slot excluded ✓ Tasks 2,7.
- Auto-grab on watch range; ≤1/day, ≤3/week; disable on limit; expire past watches ✓ Tasks 2,5,7,10.
- Grabbed sync to device (origin 'auto') ✓ Tasks 7,8.
- Notification types + master + self-suppress + quiet hours (+ night-allowed sublist) ✓ Tasks 4,7,9.
- Permission gating states (unsupported/not-installed/prompt/granted/denied) + focus recheck ✓ Tasks 3,8.
- Watch UI: 🎯 on busy slots + range sheet w/ preview + active watches, reachable from Slots ✓ Task 10.
- i18n for all new UI ✓ Tasks 9,10.

**Known limitations (documented):**
- **Self-suppression** of the device's own just-booked/cancelled actions is modeled in prefs but the cron's generic-freed push doesn't yet correlate a freed key to *this device's* recent manual cancel (only to its own grabs). A full correlation needs the device to report recent self-actions; deferred — `suppressSelf` currently suppresses nothing extra beyond auto-grab dedup. Flagged.
- Runtime (push delivery, cron grab) is validated only after deploy (Task 11).
- Device-secret model is single-shared-secret (see Task 11 note); fine for personal use.

**Placeholder scan:** none. **Type consistency:** `Watch` exists in both `worker/logic.ts` and `src/lib/watchlist.ts` with the same shape (intentional duplication across the worker/client boundary — they are bundled separately). `NotifType`/`NotifPrefs`, `PermState`, `PushSub`/`Vapid` consistent within each side.
