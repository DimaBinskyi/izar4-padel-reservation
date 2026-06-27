# Phase 1 — Foundation & Read-Only Slots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the PWA + Cloudflare Worker proxy and show live padel slots for a chosen day (status + who booked) in 4 languages, installable with auto-update — no booking yet.

**Architecture:** A Vite + React + TS PWA calls izar4 **only through a Cloudflare Worker proxy** (CORS). Pure domain logic (dates, slot-status derivation) is TDD'd with Vitest. The Worker proxies `/api/*` → `https://izar4.es/wp-json/*` behind a device-secret header. This phase is read-only.

**Tech Stack:** Vite, React 18, TypeScript, Vitest, vite-plugin-pwa (autoUpdate), i18next/react-i18next, Cloudflare Workers (Static Assets + `/api` proxy), wrangler.

See `docs/API.md` and `docs/superpowers/specs/2026-06-27-padel-reservas-design.md`.

---

## File structure (created in this phase)

```
package.json, tsconfig.json, tsconfig.node.json, vite.config.ts, index.html, vitest.config.ts
.dev.vars                      # gitignored: DEVICE_SECRET for local dev
wrangler.toml                  # Worker: static assets + /api proxy + cron (cron used in Phase 3)
src/
  main.tsx                     # React entry + i18n init + PWA register
  App.tsx                      # renders SlotsScreen
  config.ts                    # constants (term id, slugs, horizons, api base)
  vite-env.d.ts
  lib/
    types.ts                   # domain types
    dates.ts  dates.test.ts    # date helpers (TDD)
    status.ts status.test.ts   # slot-status derivation (TDD)
    izar4Client.ts izar4Client.test.ts  # API client via proxy (TDD, mocked fetch)
  i18n/
    index.ts
    locales/{uk,en,ru,es}.json
  screens/SlotsScreen.tsx
  components/{DateStrip.tsx,SlotRow.tsx}
  styles.css
worker/
  index.ts                     # proxy + static asset passthrough + device-secret guard
  index.test.ts                # proxy unit tests (TDD)
```

Each file has one responsibility: `dates.ts` (time math), `status.ts` (one slot → status), `izar4Client.ts` (network), components (presentational), `SlotsScreen.tsx` (composition).

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`, `src/styles.css`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "padel-reservas",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "worker:dev": "wrangler dev",
    "worker:deploy": "wrangler deploy"
  },
  "dependencies": {
    "i18next": "^23.11.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-i18next": "^14.1.2"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.3",
    "vite": "^5.3.4",
    "vite-plugin-pwa": "^0.20.1",
    "vitest": "^2.0.4",
    "wrangler": "^3.65.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "worker"]
}
```

- [ ] **Step 3: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Create `vite.config.ts`** (PWA config refined in Task 9; dev proxy forwards `/api` to the Worker dev server)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
```

- [ ] **Step 6: Create `index.html`**

```html
<!doctype html>
<html lang="uk">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0f17" />
    <title>Pádel</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

- [ ] **Step 8: Create `src/styles.css`** (minimal dark base; full styling lands with screens)

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0b0f17; color: #e7eefb;
  font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif; }
button { font: inherit; }
```

- [ ] **Step 9: Create `src/App.tsx`** (placeholder until Task 8)

```tsx
import { SlotsScreen } from './screens/SlotsScreen';

export default function App() {
  return <SlotsScreen />;
}
```

- [ ] **Step 10: Create `src/main.tsx`** (i18n + PWA registration added in later tasks; minimal now)

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 11: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no peer-dep errors that abort install.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS + Vitest project"
```

---

## Task 1: App config & domain types

**Files:**
- Create: `src/config.ts`, `src/lib/types.ts`

- [ ] **Step 1: Create `src/config.ts`**

```ts
// Static facts about the izar4 padel resource (see docs/API.md).
export const API_BASE = '/api/wp-json';        // proxied through the Worker
export const APP_API_BASE = '/api/wp-json/app/v1';
export const PADEL_SLUG = 'padel';
export const PADEL_TERM_ID = 12;               // taxonomy term id for filtering
export const BOOKING_HORIZON_DAYS = 21;        // how far ahead a slot can be booked
export const CALENDAR_DAYS = 31;               // how many days the strip shows (min = today)
export const NOTIFY_WINDOW_DAYS = 7;           // generic "slot freed" window (used in Phase 3)
export const WEEKLY_LIMIT = 3;                 // per vivienda (enforced by us)
export const DAILY_LIMIT = 1;                  // per vivienda
```

- [ ] **Step 2: Create `src/lib/types.ts`**

```ts
export interface Franja {
  id: number;
  slot: string;        // e.g. "P1-1" (the franja title; used in reservations)
  start: string;       // "HH:MM"
  end: string;         // "HH:MM"
  order: number;
}

export interface Reservation {
  id: number;
  slot: string;        // id_franja_reservas, e.g. "P1-2"
  fecha: string;       // YYYYMMDD
  nombre: string;
  vivienda: string;
  // codigo_cancelacion is intentionally NOT modeled here in Phase 1 (read-only, not displayed).
}

export interface DayBlock { motivo: string; }          // whole-day closure
export type WeekdayBlockSet = Record<string, true>;     // key: `${slot}_${weekdayCode}`

export type SlotStatus = 'libre' | 'ocupado' | 'bloqueado' | 'pasado' | 'pronto';

export interface SlotView {
  franja: Franja;
  status: SlotStatus;
  reservation: Reservation | null;   // present when ocupado
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: app config constants and domain types"
```

---

## Task 2: Date utilities (TDD)

**Files:**
- Create: `src/lib/dates.ts`, `src/lib/dates.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/dates.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { ymdToDate, dateToYmd, normalizeYmd, weekdayCode, addDays, isPastYmd, isTodayYmd } from './dates';

describe('dates', () => {
  it('ymdToDate / dateToYmd round-trip', () => {
    const d = ymdToDate('20260627');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June (0-based)
    expect(d.getDate()).toBe(27);
    expect(dateToYmd(d)).toBe('20260627');
  });

  it('normalizeYmd accepts Ymd and dd/mm/yyyy', () => {
    expect(normalizeYmd('20260627')).toBe('20260627');
    expect(normalizeYmd('27/06/2026')).toBe('20260627');
  });

  it('weekdayCode maps to D L M X J V S (Sun=0)', () => {
    expect(weekdayCode('20260628')).toBe('D'); // 28 Jun 2026 is Sunday
    expect(weekdayCode('20260629')).toBe('L'); // Monday
    expect(weekdayCode('20260627')).toBe('S'); // Saturday
  });

  it('addDays returns Ymd offset', () => {
    expect(addDays('20260627', 21)).toBe('20260718');
  });

  it('isTodayYmd / isPastYmd relative to a reference date', () => {
    const ref = ymdToDate('20260627');
    expect(isTodayYmd('20260627', ref)).toBe(true);
    expect(isPastYmd('20260626', ref)).toBe(true);
    expect(isPastYmd('20260628', ref)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL — `dates.ts` does not exist / functions undefined.

- [ ] **Step 3: Write minimal implementation** — `src/lib/dates.ts`

```ts
const WEEKDAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']; // Sun..Sat (izar4 codes)

export function ymdToDate(ymd: string): Date {
  return new Date(
    parseInt(ymd.slice(0, 4), 10),
    parseInt(ymd.slice(4, 6), 10) - 1,
    parseInt(ymd.slice(6, 8), 10),
  );
}

export function dateToYmd(d: Date): string {
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

export function normalizeYmd(s: string): string {
  if (/^\d{8}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}${m[2]}${m[1]}`;
  return s;
}

export function weekdayCode(ymd: string): string {
  return WEEKDAYS[ymdToDate(ymd).getDay()];
}

export function addDays(ymd: string, days: number): string {
  const d = ymdToDate(ymd);
  d.setDate(d.getDate() + days);
  return dateToYmd(d);
}

function atMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function isTodayYmd(ymd: string, today: Date): boolean {
  return atMidnight(ymdToDate(ymd)) === atMidnight(today);
}

export function isPastYmd(ymd: string, today: Date): boolean {
  return atMidnight(ymdToDate(ymd)) < atMidnight(today);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: date utilities with tests"
```

---

## Task 3: Slot-status derivation (TDD)

**Files:**
- Create: `src/lib/status.ts`, `src/lib/status.test.ts`

This is the heart of the read view. Pure function: given the day's franjas + reservations + blocks + a reference "now", produce `SlotView[]`. Mirrors `docs/API.md §5`.

- [ ] **Step 1: Write the failing test** — `src/lib/status.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { deriveSlots } from './status';
import type { Franja, Reservation } from './types';

const franjas: Franja[] = [
  { id: 106, slot: 'P1-1', start: '09:00', end: '10:00', order: 1 },
  { id: 107, slot: 'P1-2', start: '10:00', end: '11:30', order: 2 },
  { id: 108, slot: 'P1-3', start: '11:30', end: '13:00', order: 3 },
];

const res: Reservation[] = [
  { id: 1, slot: 'P1-2', fecha: '20260627', nombre: 'Ana', vivienda: 'P1-2' },
];

describe('deriveSlots', () => {
  it('marks occupied, free, and blocked-by-weekday', () => {
    // Saturday 20260627, weekday code S; block P1-3 on Saturdays
    const now = new Date(2026, 5, 27, 8, 0); // 08:00, before all slots
    const out = deriveSlots({
      fecha: '20260627',
      franjas, reservations: res,
      weekdayBlocks: { 'P1-3_S': true },
      dayBlocked: false,
      now,
    });
    expect(out.map((s) => s.status)).toEqual(['libre', 'ocupado', 'bloqueado']);
    expect(out[1].reservation?.nombre).toBe('Ana');
  });

  it('marks past slots when date is today and start time elapsed', () => {
    const now = new Date(2026, 5, 27, 10, 30); // after P1-1 and P1-2 start
    const out = deriveSlots({
      fecha: '20260627', franjas, reservations: [],
      weekdayBlocks: {}, dayBlocked: false, now,
    });
    expect(out[0].status).toBe('pasado'); // 09:00 elapsed
    expect(out[1].status).toBe('pasado'); // 10:00 elapsed
    expect(out[2].status).toBe('libre');  // 11:30 still upcoming
  });

  it('all slots bloqueado when whole day is blocked', () => {
    const now = new Date(2026, 5, 20, 8, 0);
    const out = deriveSlots({
      fecha: '20260628', franjas, reservations: [],
      weekdayBlocks: {}, dayBlocked: true, now,
    });
    expect(out.every((s) => s.status === 'bloqueado')).toBe(true);
  });

  it('past dates: occupied stays occupied, empties are pasado (view-only)', () => {
    const now = new Date(2026, 5, 27, 8, 0);
    const out = deriveSlots({
      fecha: '20260626', franjas, reservations: res /* P1-2 */,
      weekdayBlocks: {}, dayBlocked: false, now,
    });
    expect(out[0].status).toBe('pasado');
    expect(out[1].status).toBe('ocupado');
    expect(out[2].status).toBe('pasado');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/status.test.ts`
Expected: FAIL — `deriveSlots` undefined.

- [ ] **Step 3: Write minimal implementation** — `src/lib/status.ts`

```ts
import type { Franja, Reservation, SlotView, WeekdayBlockSet } from './types';
import { ymdToDate, weekdayCode, isPastYmd, isTodayYmd } from './dates';

export interface DeriveInput {
  fecha: string;                  // YYYYMMDD
  franjas: Franja[];
  reservations: Reservation[];    // already filtered to this date
  weekdayBlocks: WeekdayBlockSet; // key `${slot}_${weekdayCode}`
  dayBlocked: boolean;
  now: Date;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

export function deriveSlots(input: DeriveInput): SlotView[] {
  const { fecha, franjas, reservations, weekdayBlocks, dayBlocked, now } = input;
  const wd = weekdayCode(fecha);
  const byNum = [...franjas].sort((a, b) => a.order - b.order);
  const resBySlot = new Map(reservations.map((r) => [r.slot, r]));
  const past = isPastYmd(fecha, now);
  const today = isTodayYmd(fecha, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return byNum.map((franja): SlotView => {
    const reservation = resBySlot.get(franja.slot) ?? null;
    if (dayBlocked || weekdayBlocks[`${franja.slot}_${wd}`]) {
      return { franja, status: 'bloqueado', reservation: null };
    }
    if (reservation) return { franja, status: 'ocupado', reservation };
    // free slot
    if (past) return { franja, status: 'pasado', reservation: null };
    if (today && nowMin >= minutes(franja.start)) {
      return { franja, status: 'pasado', reservation: null };
    }
    return { franja, status: 'libre', reservation: null };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/status.test.ts`
Expected: PASS (4 tests). (`ymdToDate` import kept for clarity; remove if linter flags unused.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: slot-status derivation with tests"
```

---

## Task 4: Cloudflare Worker proxy (TDD)

**Files:**
- Create: `worker/index.ts`, `worker/index.test.ts`, `wrangler.toml`, `.dev.vars`

The Worker forwards `/api/*` to `https://izar4.es/*`, requires a device-secret header, and adds permissive CORS for the app origin. Static-asset serving is configured in `wrangler.toml` (Phase 1 keeps the handler focused on `/api`).

- [ ] **Step 1: Write the failing test** — `worker/index.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index';

const ENV = { DEVICE_SECRET: 's3cret', ASSETS: { fetch: async () => new Response('asset') } } as any;

beforeEach(() => vi.restoreAllMocks());

describe('worker proxy', () => {
  it('rejects /api without the device secret', async () => {
    const res = await worker.fetch(new Request('https://app.dev/api/wp-json/wp/v2/reservas'), ENV);
    expect(res.status).toBe(401);
  });

  it('proxies /api/* to izar4 with secret present', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[{"id":1}]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const req = new Request('https://app.dev/api/wp-json/wp/v2/reservas?recurso=12', {
      headers: { 'x-device-secret': 's3cret' },
    });
    const res = await worker.fetch(req, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const calledUrl = (spy.mock.calls[0][0] as Request).url ?? spy.mock.calls[0][0];
    expect(String(calledUrl)).toBe('https://izar4.es/wp-json/wp/v2/reservas?recurso=12');
  });

  it('answers CORS preflight', async () => {
    const res = await worker.fetch(
      new Request('https://app.dev/api/wp-json/app/v1/reservar', { method: 'OPTIONS' }), ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('falls through to static assets for non-/api paths', async () => {
    const res = await worker.fetch(new Request('https://app.dev/index.html'), ENV);
    expect(await res.text()).toBe('asset');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/index.test.ts`
Expected: FAIL — `worker/index.ts` missing.

- [ ] **Step 3: Write minimal implementation** — `worker/index.ts`

```ts
export interface Env {
  DEVICE_SECRET: string;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

const IZAR4 = 'https://izar4.es';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-device-secret',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      if (req.headers.get('x-device-secret') !== env.DEVICE_SECRET) {
        return new Response('unauthorized', { status: 401, headers: CORS });
      }

      const target = IZAR4 + url.pathname.replace(/^\/api/, '') + url.search;
      const init: RequestInit = {
        method: req.method,
        headers: { 'content-type': req.headers.get('content-type') ?? 'application/json' },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      };
      const upstream = await fetch(target, init);
      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return env.ASSETS.fetch(req);
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/index.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Create `wrangler.toml`**

```toml
name = "izar4-padel"
main = "worker/index.ts"
compatibility_date = "2024-09-01"

assets = { directory = "./dist", binding = "ASSETS" }

# Cron is added in Phase 3:
# [triggers]
# crons = ["* * * * *"]
```

- [ ] **Step 6: Create `.dev.vars`** (gitignored)

```
DEVICE_SECRET=dev-local-secret
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: Cloudflare Worker izar4 proxy with device-secret + CORS, with tests"
```

---

## Task 5: izar4 client through the proxy (TDD)

**Files:**
- Create: `src/lib/izar4Client.ts`, `src/lib/izar4Client.test.ts`

Maps raw izar4 JSON (see `docs/API.md`) into domain types, sending the device secret header.

- [ ] **Step 1: Write the failing test** — `src/lib/izar4Client.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFranjas, fetchReservations } from './izar4Client';

beforeEach(() => vi.restoreAllMocks());

function mockJson(data: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}

describe('izar4Client', () => {
  it('maps franjas to domain Franja[]', async () => {
    mockJson([
      { id: 106, slug: 'p1-1', title: { rendered: 'P1-1' },
        acf: { hora_inicio_franjas: '09:00:00', hora_fin_franjas: '10:00:00', orden_franjas: 1 } },
    ]);
    const out = await fetchFranjas('secret');
    expect(out[0]).toEqual({ id: 106, slot: 'P1-1', start: '09:00', end: '10:00', order: 1 });
  });

  it('maps reservations and filters by date', async () => {
    mockJson([
      { id: 1, slug: '20260627-padel-p1-2', acf: {
        id_franja_reservas: 'P1-2', fecha_reservas: '20260627',
        nombre_reservas: 'Ana', vivienda_reservas: 'P1-2' } },
      { id: 2, slug: '20260628-padel-p1-1', acf: {
        id_franja_reservas: 'P1-1', fecha_reservas: '20260628',
        nombre_reservas: 'Bob', vivienda_reservas: 'P1-1' } },
    ]);
    const out = await fetchReservations('secret', '20260627');
    expect(out).toHaveLength(1);
    expect(out[0].nombre).toBe('Ana');
  });

  it('sends the device secret header', async () => {
    const spy = mockJson([]);
    await fetchFranjas('secret');
    const req = spy.mock.calls[0][0] as Request;
    const headers = (spy.mock.calls[0][1] as RequestInit)?.headers as Record<string, string> | undefined;
    const sent = headers?.['x-device-secret'] ?? new Headers(req.headers).get('x-device-secret');
    expect(sent).toBe('secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/izar4Client.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation** — `src/lib/izar4Client.ts`

```ts
import { API_BASE, PADEL_TERM_ID } from '../config';
import type { Franja, Reservation, DayBlock, WeekdayBlockSet } from './types';
import { normalizeYmd } from './dates';

function get(path: string, secret: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    headers: { 'x-device-secret': secret },
    cache: 'no-store',
  });
}

export async function fetchFranjas(secret: string): Promise<Franja[]> {
  const r = await get(`/wp/v2/franjas?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,slug,title,acf`, secret);
  const data = (await r.json()) as any[];
  return data.map((f) => ({
    id: f.id,
    slot: f.title?.rendered ?? f.slug,
    start: (f.acf?.hora_inicio_franjas ?? '--:--').slice(0, 5),
    end: (f.acf?.hora_fin_franjas ?? '--:--').slice(0, 5),
    order: Number(f.acf?.orden_franjas ?? 999),
  }));
}

export async function fetchReservations(secret: string, fecha: string): Promise<Reservation[]> {
  const r = await get(`/wp/v2/reservas?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,slug,acf`, secret);
  const data = (await r.json()) as any[];
  return data
    .filter((x) => x.acf && normalizeYmd(x.acf.fecha_reservas) === fecha)
    .map((x) => ({
      id: x.id,
      slot: x.acf.id_franja_reservas,
      fecha: normalizeYmd(x.acf.fecha_reservas),
      nombre: x.acf.nombre_reservas ?? '',
      vivienda: x.acf.vivienda_reservas ?? '',
    }));
}

export async function fetchWeekdayBlocks(secret: string): Promise<WeekdayBlockSet> {
  const r = await get(`/wp/v2/bloqueos?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,acf`, secret);
  const data = (await r.json()) as any[];
  const set: WeekdayBlockSet = {};
  for (const b of data) {
    const slot = b.acf?.id_franja_bloqueos;
    const dia = b.acf?.dia_semana_bloqueos;
    if (slot && dia) set[`${slot}_${dia}`] = true;
  }
  return set;
}

export async function fetchDayBlock(secret: string, fecha: string): Promise<DayBlock | null> {
  const r = await get(`/wp/v2/bloqueos-fecha?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,acf`, secret);
  const data = (await r.json()) as any[];
  const hit = data.find((b) => b.acf && normalizeYmd(b.acf['fecha_bloqueo_bloqueos-fecha']) === fecha);
  return hit ? { motivo: hit.acf['motivo_bloqueos-fecha'] ?? '' } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/izar4Client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: izar4 client (franjas/reservations/blocks) via proxy, with tests"
```

---

## Task 6: i18n setup + locale files

**Files:**
- Create: `src/i18n/index.ts`, `src/i18n/locales/{uk,en,ru,es}.json`
- Modify: `src/main.tsx`

- [ ] **Step 1: Create `src/i18n/locales/uk.json`** (default)

```json
{
  "app": { "title": "Pádel" },
  "tabs": { "slots": "Слоти", "watch": "Ловлю", "stats": "Статистика", "settings": "Налаштування" },
  "slots": {
    "selectDate": "Оберіть дату",
    "loading": "Завантаження слотів…",
    "error": "Помилка завантаження слотів.",
    "dayBlocked": "День заблоковано. Бронювання недоступне.",
    "viewOnlyBeyondHorizon": "Поза вікном бронювання — лише перегляд"
  },
  "status": { "libre": "Вільно", "ocupado": "Зайнято", "bloqueado": "Заблоковано", "pasado": "Минув", "pronto": "Скоро", "mine": "Моя" }
}
```

- [ ] **Step 2: Create `src/i18n/locales/en.json`**

```json
{
  "app": { "title": "Pádel" },
  "tabs": { "slots": "Slots", "watch": "Watch", "stats": "Stats", "settings": "Settings" },
  "slots": {
    "selectDate": "Select a date",
    "loading": "Loading slots…",
    "error": "Failed to load slots.",
    "dayBlocked": "Day is blocked. Booking unavailable.",
    "viewOnlyBeyondHorizon": "Beyond booking window — view only"
  },
  "status": { "libre": "Free", "ocupado": "Busy", "bloqueado": "Blocked", "pasado": "Past", "pronto": "Soon", "mine": "Mine" }
}
```

- [ ] **Step 3: Create `src/i18n/locales/ru.json`**

```json
{
  "app": { "title": "Pádel" },
  "tabs": { "slots": "Слоты", "watch": "Ловлю", "stats": "Статистика", "settings": "Настройки" },
  "slots": {
    "selectDate": "Выберите дату",
    "loading": "Загрузка слотов…",
    "error": "Ошибка загрузки слотов.",
    "dayBlocked": "День заблокирован. Бронирование недоступно.",
    "viewOnlyBeyondHorizon": "Вне окна брони — только просмотр"
  },
  "status": { "libre": "Свободен", "ocupado": "Занят", "bloqueado": "Заблокирован", "pasado": "Прошёл", "pronto": "Скоро", "mine": "Моя" }
}
```

- [ ] **Step 4: Create `src/i18n/locales/es.json`**

```json
{
  "app": { "title": "Pádel" },
  "tabs": { "slots": "Turnos", "watch": "Captura", "stats": "Estadísticas", "settings": "Ajustes" },
  "slots": {
    "selectDate": "Selecciona una fecha",
    "loading": "Cargando turnos…",
    "error": "Error al cargar los turnos.",
    "dayBlocked": "Día bloqueado. Reserva no disponible.",
    "viewOnlyBeyondHorizon": "Fuera del plazo de reserva — solo consulta"
  },
  "status": { "libre": "Libre", "ocupado": "Ocupado", "bloqueado": "Bloqueado", "pasado": "Pasado", "pronto": "Pronto", "mine": "Mía" }
}
```

- [ ] **Step 5: Create `src/i18n/index.ts`**

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uk from './locales/uk.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
import es from './locales/es.json';

const STORAGE_KEY = 'padel_lang';
const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;

void i18n.use(initReactI18next).init({
  resources: { uk: { translation: uk }, en: { translation: en }, ru: { translation: ru }, es: { translation: es } },
  lng: saved ?? 'uk',
  fallbackLng: 'uk',
  interpolation: { escapeValue: false },
});

export function setLanguage(lng: 'uk' | 'en' | 'ru' | 'es') {
  void i18n.changeLanguage(lng);
  localStorage.setItem(STORAGE_KEY, lng);
}

export default i18n;
```

- [ ] **Step 6: Modify `src/main.tsx`** — import i18n before App

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 7: Verify build typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: i18n setup with uk/en/ru/es locales (uk default)"
```

---

## Task 7: DateStrip component

**Files:**
- Create: `src/components/DateStrip.tsx`

Renders `CALENDAR_DAYS` days from today; days beyond `BOOKING_HORIZON_DAYS` are dimmed (view-only); selected day highlighted.

- [ ] **Step 1: Create `src/components/DateStrip.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { addDays, ymdToDate } from '../lib/dates';
import { CALENDAR_DAYS, BOOKING_HORIZON_DAYS } from '../config';

interface Props {
  todayYmd: string;
  selected: string;
  onSelect: (ymd: string) => void;
}

export function DateStrip({ todayYmd, selected, onSelect }: Props) {
  const { i18n } = useTranslation();
  const days = Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(todayYmd, i));
  const fmtW = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
  const fmtM = new Intl.DateTimeFormat(i18n.language, { month: 'short' });

  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '6px 14px 10px' }}>
      {days.map((ymd, i) => {
        const d = ymdToDate(ymd);
        const sel = ymd === selected;
        const beyond = i > BOOKING_HORIZON_DAYS;
        return (
          <button
            key={ymd}
            onClick={() => onSelect(ymd)}
            style={{
              flex: '0 0 auto', width: 46, textAlign: 'center', padding: '7px 0',
              borderRadius: 12, border: '1px solid ' + (sel ? '#1d4ed8' : '#1f2b3c'),
              background: sel ? '#1d4ed8' : '#121b28', color: '#e7eefb',
              opacity: beyond ? 0.4 : 1,
            }}
          >
            <div style={{ fontSize: 10, color: sel ? '#cfe0ff' : '#90a4bf' }}>{fmtW.format(d)}</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{d.getDate()}</div>
            <div style={{ fontSize: 9.5, color: sel ? '#cfe0ff' : '#90a4bf' }}>{fmtM.format(d)}</div>
          </button>
        );
      })}
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
git commit -m "feat: DateStrip (month view, today min, horizon dimming)"
```

---

## Task 8: SlotRow component

**Files:**
- Create: `src/components/SlotRow.tsx`

- [ ] **Step 1: Create `src/components/SlotRow.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import type { SlotView } from '../lib/types';

const BADGE: Record<string, { bg: string; fg: string }> = {
  libre: { bg: '#10261a', fg: '#7ee2a8' },
  ocupado: { bg: '#2a1414', fg: '#ff9b9b' },
  bloqueado: { bg: '#1a1a1a', fg: '#7a7a7a' },
  pasado: { bg: '#1a1a1a', fg: '#7a7a7a' },
  pronto: { bg: '#241a00', fg: '#f2c14e' },
};

export function SlotRow({ slot }: { slot: SlotView }) {
  const { t } = useTranslation();
  const c = BADGE[slot.status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 8px', borderBottom: '1px solid #141d2a' }}>
      <div style={{ width: 96, fontSize: 12.5, fontWeight: 600 }}>
        {slot.franja.start}–{slot.franja.end}
      </div>
      <div style={{ width: 78 }}>
        <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.fg }}>
          {t(`status.${slot.status}`)}
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
git commit -m "feat: SlotRow component (status badge + booker)"
```

---

## Task 9: SlotsScreen (compose data + UI)

**Files:**
- Create: `src/screens/SlotsScreen.tsx`
- Create: `src/lib/deviceSecret.ts`

- [ ] **Step 1: Create `src/lib/deviceSecret.ts`**

```ts
const KEY = 'padel_device_secret';

export function getDeviceSecret(): string {
  let s = localStorage.getItem(KEY);
  if (!s) {
    s = crypto.randomUUID();
    localStorage.setItem(KEY, s);
  }
  return s;
}
```

> Note: in dev, the Worker checks `DEVICE_SECRET` from `.dev.vars`. For Phase 1 local testing set
> the same value in localStorage via devtools, or temporarily relax the check. Real per-device
> registration is wired in Phase 3 (`/subscribe`).

- [ ] **Step 2: Create `src/screens/SlotsScreen.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateStrip } from '../components/DateStrip';
import { SlotRow } from '../components/SlotRow';
import { deriveSlots } from '../lib/status';
import { fetchFranjas, fetchReservations, fetchWeekdayBlocks, fetchDayBlock } from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { dateToYmd } from '../lib/dates';
import type { SlotView } from '../lib/types';

export function SlotsScreen() {
  const { t } = useTranslation();
  const today = dateToYmd(new Date());
  const [selected, setSelected] = useState(today);
  const [slots, setSlots] = useState<SlotView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const secret = getDeviceSecret();
    setSlots(null); setError(null); setBlockedMsg(null);
    (async () => {
      try {
        const [franjas, reservations, weekdayBlocks, dayBlock] = await Promise.all([
          fetchFranjas(secret),
          fetchReservations(secret, selected),
          fetchWeekdayBlocks(secret),
          fetchDayBlock(secret, selected),
        ]);
        if (cancelled) return;
        if (dayBlock) { setBlockedMsg(dayBlock.motivo || t('slots.dayBlocked')); setSlots([]); return; }
        setSlots(deriveSlots({
          fecha: selected, franjas, reservations, weekdayBlocks,
          dayBlocked: false, now: new Date(),
        }));
      } catch {
        if (!cancelled) setError(t('slots.error'));
      }
    })();
    return () => { cancelled = true; };
  }, [selected, t]);

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <header style={{ textAlign: 'center', padding: '12px 0', fontSize: 17, fontWeight: 700 }}>
        {t('app.title')}
      </header>
      <DateStrip todayYmd={today} selected={selected} onSelect={setSelected} />
      <div style={{ padding: '2px 10px 8px' }}>
        {error && <div style={{ padding: 16, color: '#ff9b9b' }}>{error}</div>}
        {blockedMsg && <div style={{ padding: 16, color: '#f2c14e' }}>{blockedMsg}</div>}
        {!error && !blockedMsg && slots === null && (
          <div style={{ padding: 16, color: '#8aa0bd' }}>{t('slots.loading')}</div>
        )}
        {slots?.map((s) => <SlotRow key={s.franja.slot} slot={s} />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test (two terminals)**

Run A: `npm run worker:dev`  (wrangler dev on :8787)
Run B: in devtools console set the secret to match `.dev.vars`: `localStorage.setItem('padel_device_secret','dev-local-secret')`
Run C: `npm run dev` → open the printed URL.
Expected: today's padel slots render with status badges and bookers; switching dates reloads.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: SlotsScreen renders live padel slots for a selected day"
```

---

## Task 10: PWA (installable + auto-update)

**Files:**
- Modify: `vite.config.ts`, `src/main.tsx`
- Create: `public/icon-192.png`, `public/icon-512.png` (placeholder icons; replace later)

- [ ] **Step 1: Modify `vite.config.ts`** to add `vite-plugin-pwa` with autoUpdate

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Pádel Reservas',
        short_name: 'Pádel',
        lang: 'uk',
        theme_color: '#0b0f17',
        background_color: '#0b0f17',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: { navigateFallback: '/index.html' },
    }),
  ],
  server: { proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } } },
});
```

- [ ] **Step 2: Add placeholder icons**

Run: `mkdir -p public && printf '' > public/.gitkeep`
Then add two PNGs at `public/icon-192.png` and `public/icon-512.png` (any square PNGs; replace with branded icons later). Until real icons exist, generate solid-color placeholders, e.g. with an online tool or design app — do not ship an empty file (manifest install fails on 0-byte icons).

- [ ] **Step 3: Modify `src/main.tsx`** to register the service worker with focus-update check

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './i18n';
import './styles.css';

const updateSW = registerSW({ immediate: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void updateSW();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: Build to verify PWA artifacts generate**

Run: `npm run build`
Expected: `dist/` contains `manifest.webmanifest`, `sw.js`, hashed assets. No TS errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: PWA installable with autoUpdate + focus update-check"
```

---

## Task 11: Deploy to Cloudflare (one Worker serving PWA + /api)

**Files:** none (operational). Requires a free Cloudflare account + `wrangler login`.

- [ ] **Step 1: Authenticate wrangler**

Run: `npx wrangler login`
Expected: browser auth completes; `wrangler whoami` shows the account.

- [ ] **Step 2: Set the production device secret**

Run: `npx wrangler secret put DEVICE_SECRET`
Enter a long random value. (The PWA must send the same value; for now match it via localStorage as in Task 9 Step 4. Phase 3 replaces this with proper `/subscribe` registration.)

- [ ] **Step 3: Build the PWA**

Run: `npm run build`
Expected: `dist/` produced (served by the Worker per `wrangler.toml` `assets`).

- [ ] **Step 4: Deploy**

Run: `npm run worker:deploy`
Expected: a `https://izar4-padel.<account>.workers.dev` URL (name auto-suffixed if taken). Open it on a phone; verify slots load through `/api`. Add to Home Screen on iOS to confirm standalone launch.

- [ ] **Step 5: Commit any config changes**

```bash
git add -A
git commit -m "chore: Cloudflare deploy config for Phase 1"
```

---

## Self-Review

**Spec coverage (Phase 1 portion):**
- PWA stack (Vite+React+TS+vite-plugin-pwa) ✓ Tasks 0,10. i18n uk default + 4 locales ✓ Task 6.
- Worker proxy + device-secret + CORS ✓ Task 4. Client via proxy ✓ Task 5.
- Slot-status derivation incl. past/blocked/day-block ✓ Task 3. Month strip, today min, 21-day horizon dimming ✓ Task 7. Who-booked display ✓ Task 8/9.
- Auto-update (autoUpdate + focus check) ✓ Task 10. Deploy free on Cloudflare ✓ Task 11.
- Date normalization + weekday codes ✓ Task 2.
- **Deferred to later phases (intentional):** booking/cancel, profile, my-bookings, stats (Phase 2); push, auto-grab, watchlist, notification settings, permission gating, KV, cron (Phase 3). "pronto"/min-antelacion badge wiring is also Phase 2 (status enum supports it).

**Placeholder scan:** No TBD/TODO logic. Icons in Task 10 are explicitly real PNGs (not empty). Device-secret note flags the Phase 3 handoff rather than leaving a gap.

**Type consistency:** `Franja.slot`, `Reservation.slot/fecha/nombre/vivienda`, `SlotView.status` used identically across `types.ts`, `status.ts`, `izar4Client.ts`, components. Worker `Env` matches test + wrangler bindings (`DEVICE_SECRET`, `ASSETS`).

---

## Notes for Phase 2 & 3 (not implemented here)
- **Phase 2:** profile (localStorage + first-run/edit), booking modal + create (limits 3/wk·1/day per vivienda), cancel decision tree + per-booking code memory (IndexedDB), my-bookings view, stats with period selector.
- **Phase 3:** Worker KV + `/subscribe` + Cron (2/10-min) poll→diff→auto-grab→Web Push (VAPID); watchlist UI (range picker + preview); notification settings (toggles, quiet-hours sublist, self-suppression); OS-permission gating (iOS/Android A/B/C) with focus recheck; deep-link on `notificationclick`.
