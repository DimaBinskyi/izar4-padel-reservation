# Phase 2b — My Bookings, Stats, Install Banner & Nav — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom tab navigation, a "My bookings" screen (all upcoming bookings matched as mine, with origin badges + cancel), a "Stats" screen (period selector, default current month), a Settings screen (profile edit, language, limits info, install), and a dismissible install banner.

**Architecture:** Builds on Phase 1+2a. Pure stats aggregation (TDD). State-based tab navigation in `App.tsx` (no router lib). Reuses `CancelModal`, `ProfileModal`, `fetchAllReservations`, `bookingsDb`, `isMine`.

**Tech Stack:** Same as before. No new deps.

References: spec §6 (screens 4,5,9,10,12), §8 (origin badges), §12 (i18n); `CLAUDE.md`.

---

## File structure (this phase)

```
src/lib/stats.ts            stats.test.ts     # period ranges + aggregation (TDD)
src/components/NavBar.tsx                      # bottom tab bar
src/components/InstallBanner.tsx              # dismissible install prompt (offer policy)
src/screens/MyBookingsScreen.tsx             # all upcoming mine + cancel
src/screens/StatsScreen.tsx                  # period selector + counters + history
src/screens/SettingsScreen.tsx               # profile edit, language, limits info, install
src/App.tsx (modify)                          # tab state + render
src/i18n/locales/*.json (modify)             # nav/mybookings/stats/settings/install keys
```

---

## Task 1: Stats aggregation (TDD)

**Files:** Create `src/lib/stats.ts`, `src/lib/stats.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/stats.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { periodRange, aggregate } from './stats';
import type { BookingRecord } from './bookingsDb';

function rec(over: Partial<BookingRecord>): BookingRecord {
  return {
    key: `${over.fecha}|${over.slot}`, reservaId: 1, fecha: '20260615', slot: 'P1-8',
    start: '19:00', end: '20:30', nombre: 'D', vivienda: 'P3-7', codigoUsed: 'c',
    origin: 'app', status: 'active', createdAt: 1, ...over,
  } as BookingRecord;
}

describe('periodRange', () => {
  it('month range for June 2026', () => {
    expect(periodRange('month', '20260615')).toEqual({ from: '20260601', to: '20260630' });
  });
  it('week range (Mon..Sun) for a Saturday', () => {
    expect(periodRange('week', '20260627')).toEqual({ from: '20260622', to: '20260628' });
  });
  it('all range is unbounded', () => {
    expect(periodRange('all', '20260615')).toEqual({ from: '00000000', to: '99999999' });
  });
});

describe('aggregate', () => {
  const today = '20260615';
  const recs: BookingRecord[] = [
    rec({ fecha: '20260610', slot: 'P1-8', status: 'active' }),   // played (past, active), 1.5h
    rec({ fecha: '20260612', slot: 'P1-8', status: 'cancelled' }),// cancelled
    rec({ fecha: '20260620', slot: 'P1-1', start: '09:00', end: '10:00', status: 'active' }), // upcoming 1h
    rec({ fecha: '20260620', slot: 'P1-8', origin: 'auto', status: 'active' }), // upcoming auto 1.5h
    rec({ fecha: '20260505', slot: 'P1-8', status: 'active' }),   // outside month
  ];

  it('counts within the month period', () => {
    const r = aggregate(recs, periodRange('month', today), today);
    expect(r.total).toBe(4);        // excludes the May one
    expect(r.cancelled).toBe(1);
    expect(r.played).toBe(1);       // 20260610 active & past
    expect(r.upcoming).toBe(2);     // two on 20260620
    expect(r.autoGrabbed).toBe(1);
    expect(r.favouriteSlot).toBe('P1-8'); // appears most among active
    expect(r.hours).toBeCloseTo(1.5 + 1 + 1.5); // active only: 4.0
  });
});
```

- [ ] **Step 2: Run — fails.** `npx vitest run src/lib/stats.test.ts`

- [ ] **Step 3: Implement** — `src/lib/stats.ts`

```ts
import type { BookingRecord } from './bookingsDb';
import { weekRange } from './limits';

export type Period = 'week' | 'month' | 'all' | 'custom';

export interface DateRange { from: string; to: string }

export function periodRange(period: Period, todayYmd: string, custom?: DateRange): DateRange {
  if (period === 'all') return { from: '00000000', to: '99999999' };
  if (period === 'custom' && custom) return custom;
  if (period === 'week') {
    const w = weekRange(todayYmd);
    return { from: w.monday, to: w.sunday };
  }
  // month
  const y = todayYmd.slice(0, 4);
  const m = todayYmd.slice(4, 6);
  const last = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
  return { from: `${y}${m}01`, to: `${y}${m}${String(last).padStart(2, '0')}` };
}

export interface StatsResult {
  total: number; played: number; cancelled: number; upcoming: number;
  autoGrabbed: number; hours: number; favouriteSlot: string | null;
}

function durationH(start: string, end: string): number {
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  return Math.max(0, (toMin(end) - toMin(start)) / 60);
}

export function aggregate(records: BookingRecord[], range: DateRange, todayYmd: string): StatsResult {
  const inRange = records.filter((r) => r.fecha >= range.from && r.fecha <= range.to);
  const active = inRange.filter((r) => r.status === 'active');
  const counts: Record<string, number> = {};
  for (const r of active) counts[r.slot] = (counts[r.slot] ?? 0) + 1;
  let favouriteSlot: string | null = null;
  let best = 0;
  for (const [slot, n] of Object.entries(counts)) if (n > best) { best = n; favouriteSlot = slot; }
  return {
    total: inRange.length,
    cancelled: inRange.filter((r) => r.status === 'cancelled').length,
    played: active.filter((r) => r.fecha < todayYmd).length,
    upcoming: active.filter((r) => r.fecha >= todayYmd).length,
    autoGrabbed: active.filter((r) => r.origin === 'auto').length,
    hours: active.reduce((sum, r) => sum + durationH(r.start, r.end), 0),
    favouriteSlot,
  };
}
```

- [ ] **Step 4: Run — passes (4 tests).** `npx vitest run src/lib/stats.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: stats aggregation (period ranges + counters) with tests"
```

---

## Task 2: i18n keys for nav/mybookings/stats/settings/install

**Files:** Modify `src/i18n/locales/{uk,en,ru,es}.json` (merge new blocks)

- [ ] **Step 1: Add these blocks to each locale (merge, keep existing keys).**

`uk.json`:
```json
  "nav": { "slots": "Слоти", "mybookings": "Мої броні", "stats": "Статистика", "settings": "Налаштування" },
  "mybookings": { "title": "Мої броні", "empty": "Немає майбутніх броней.", "subtitle": "Майбутні · за «Квартира + ім'я»",
    "originApp": "📱 у застосунку", "originAuto": "🎯 авто-перехоплення", "originIzar4": "🌐 на сайті izar4", "cancel": "Скасувати" },
  "stats": { "title": "Статистика", "week": "Тиждень", "month": "Місяць", "all": "Все", "custom": "Період",
    "bookings": "броней", "played": "зіграно", "cancelled": "скасувань", "upcoming": "майбутні",
    "favourite": "Улюблений слот", "autoGrabbed": "Спіймано авто", "hours": "Годин на корті", "history": "Історія", "none": "—" },
  "settings": { "title": "Налаштування", "profile": "Профіль", "language": "Мова інтерфейсу",
    "limits": "Ліміти", "limitsValue": "3 на тиждень · 1 на день", "version": "Версія", "install": "Встановити застосунок", "editProfile": "Редагувати профіль" },
  "install": { "banner": "Встанови застосунок для пушів і швидкого доступу", "ios": "Натисни «Поділитися» → «На екран Початок»", "cta": "Встановити", "later": "Пізніше" }
```

`en.json`:
```json
  "nav": { "slots": "Slots", "mybookings": "My bookings", "stats": "Stats", "settings": "Settings" },
  "mybookings": { "title": "My bookings", "empty": "No upcoming bookings.", "subtitle": "Upcoming · by Apartment + name",
    "originApp": "📱 in app", "originAuto": "🎯 auto-grab", "originIzar4": "🌐 on izar4 site", "cancel": "Cancel" },
  "stats": { "title": "Stats", "week": "Week", "month": "Month", "all": "All", "custom": "Range",
    "bookings": "bookings", "played": "played", "cancelled": "cancelled", "upcoming": "upcoming",
    "favourite": "Favourite slot", "autoGrabbed": "Auto-grabbed", "hours": "Hours on court", "history": "History", "none": "—" },
  "settings": { "title": "Settings", "profile": "Profile", "language": "Interface language",
    "limits": "Limits", "limitsValue": "3 per week · 1 per day", "version": "Version", "install": "Install app", "editProfile": "Edit profile" },
  "install": { "banner": "Install the app for push and quick access", "ios": "Tap Share → Add to Home Screen", "cta": "Install", "later": "Later" }
```

`ru.json`:
```json
  "nav": { "slots": "Слоты", "mybookings": "Мои брони", "stats": "Статистика", "settings": "Настройки" },
  "mybookings": { "title": "Мои брони", "empty": "Нет предстоящих броней.", "subtitle": "Предстоящие · по «Квартира + имя»",
    "originApp": "📱 в приложении", "originAuto": "🎯 авто-перехват", "originIzar4": "🌐 на сайте izar4", "cancel": "Отменить" },
  "stats": { "title": "Статистика", "week": "Неделя", "month": "Месяц", "all": "Всё", "custom": "Период",
    "bookings": "броней", "played": "сыграно", "cancelled": "отмен", "upcoming": "предстоящие",
    "favourite": "Любимый слот", "autoGrabbed": "Поймано авто", "hours": "Часов на корте", "history": "История", "none": "—" },
  "settings": { "title": "Настройки", "profile": "Профиль", "language": "Язык интерфейса",
    "limits": "Лимиты", "limitsValue": "3 в неделю · 1 в день", "version": "Версия", "install": "Установить приложение", "editProfile": "Редактировать профиль" },
  "install": { "banner": "Установи приложение для пушей и быстрого доступа", "ios": "Нажми «Поделиться» → «На экран Домой»", "cta": "Установить", "later": "Позже" }
```

`es.json`:
```json
  "nav": { "slots": "Turnos", "mybookings": "Mis reservas", "stats": "Estadísticas", "settings": "Ajustes" },
  "mybookings": { "title": "Mis reservas", "empty": "No hay reservas próximas.", "subtitle": "Próximas · por Vivienda + nombre",
    "originApp": "📱 en la app", "originAuto": "🎯 captura automática", "originIzar4": "🌐 en la web izar4", "cancel": "Cancelar" },
  "stats": { "title": "Estadísticas", "week": "Semana", "month": "Mes", "all": "Todo", "custom": "Periodo",
    "bookings": "reservas", "played": "jugadas", "cancelled": "canceladas", "upcoming": "próximas",
    "favourite": "Turno favorito", "autoGrabbed": "Capturadas auto", "hours": "Horas en pista", "history": "Historial", "none": "—" },
  "settings": { "title": "Ajustes", "profile": "Perfil", "language": "Idioma de la interfaz",
    "limits": "Límites", "limitsValue": "3 por semana · 1 por día", "version": "Versión", "install": "Instalar app", "editProfile": "Editar perfil" },
  "install": { "banner": "Instala la app para notificaciones y acceso rápido", "ios": "Pulsa Compartir → Añadir a pantalla de inicio", "cta": "Instalar", "later": "Más tarde" }
```

- [ ] **Step 2: Verify JSON parses + tests green.** `node -e "['uk','en','ru','es'].forEach(l=>require('./src/i18n/locales/'+l+'.json'))"` then `npx vitest run`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: i18n keys for nav/mybookings/stats/settings/install"
```

---

## Task 3: InstallBanner component

**Files:** Create `src/components/InstallBanner.tsx`

- [ ] **Step 1: Implement** — `src/components/InstallBanner.tsx`

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }>; }

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}
function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

const DISMISS_KEY = 'padel_install_dismissed';

export function InstallBanner() {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;
    const onBIP = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); setShow(true); };
    window.addEventListener('beforeinstallprompt', onBIP);
    if (isIOS()) setShow(true); // iOS: no event, show instructions
    return () => window.removeEventListener('beforeinstallprompt', onBIP);
  }, []);

  if (!show) return null;

  function dismiss() { localStorage.setItem(DISMISS_KEY, '1'); setShow(false); }
  async function install() {
    if (deferred) { await deferred.prompt(); setShow(false); }
  }

  return (
    <div style={{ margin: '8px 14px', background: '#101a2b', border: '1px solid #21304a', borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, fontSize: 12.5, color: '#cfe0f5' }}>
        {t('install.banner')}
        {isIOS() && !deferred && <div style={{ fontSize: 11, color: '#86b7ff', marginTop: 4 }}>{t('install.ios')}</div>}
      </div>
      {deferred && (
        <button onClick={install} style={{ border: 'none', borderRadius: 9, padding: '8px 12px', background: '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: 12.5 }}>{t('install.cta')}</button>
      )}
      <button onClick={dismiss} aria-label="dismiss" style={{ border: 'none', borderRadius: 9, padding: '8px 10px', background: '#16202e', color: '#8aa0bd', fontSize: 12.5 }}>{t('install.later')}</button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit` — no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: dismissible InstallBanner (Android one-tap / iOS instructions)"
```

---

## Task 4: NavBar component

**Files:** Create `src/components/NavBar.tsx`

- [ ] **Step 1: Implement** — `src/components/NavBar.tsx`

```tsx
import { useTranslation } from 'react-i18next';

export type Tab = 'slots' | 'mybookings' | 'stats' | 'settings';
const ICONS: Record<Tab, string> = { slots: '📅', mybookings: '🗂', stats: '📊', settings: '⚙️' };

export function NavBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { t } = useTranslation();
  const tabs: Tab[] = ['slots', 'mybookings', 'stats', 'settings'];
  return (
    <nav style={{ position: 'sticky', bottom: 0, display: 'flex', borderTop: '1px solid #1c2533', background: '#0b0f17' }}>
      {tabs.map((x) => (
        <button key={x} onClick={() => onChange(x)}
          style={{ flex: 1, textAlign: 'center', padding: '9px 0 11px', border: 'none', background: 'transparent', fontSize: 10.5, color: tab === x ? '#86b7ff' : '#7e92ad' }}>
          <span style={{ fontSize: 16, display: 'block', marginBottom: 2 }}>{ICONS[x]}</span>
          {t(`nav.${x}`)}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: bottom NavBar (4 tabs)"
```

---

## Task 5: MyBookingsScreen

**Files:** Create `src/screens/MyBookingsScreen.tsx`

- [ ] **Step 1: Implement** — `src/screens/MyBookingsScreen.tsx`

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CancelModal } from '../components/CancelModal';
import { fetchAllReservations, fetchFranjas, cancelReservation } from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { listBookings, markCancelled, type BookingRecord } from '../lib/bookingsDb';
import { isMine } from '../lib/mine';
import { dateToYmd, ymdToDate } from '../lib/dates';
import type { Profile } from '../lib/profile';
import type { Franja, Reservation, SlotView } from '../lib/types';

export function MyBookingsScreen({ profile }: { profile: Profile }) {
  const { t, i18n } = useTranslation();
  const today = dateToYmd(new Date());
  const secret = getDeviceSecret();
  const [rows, setRows] = useState<{ res: Reservation; franja: Franja; origin: string }[] | null>(null);
  const [cancelRow, setCancelRow] = useState<{ res: Reservation; franja: Franja } | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const [all, franjas, log] = await Promise.all([fetchAllReservations(secret), fetchFranjas(secret), listBookings()]);
    const fmap = new Map(franjas.map((f) => [f.slot, f]));
    const lmap = new Map<string, BookingRecord>(log.map((r) => [`${r.fecha}|${r.slot}`, r]));
    const mine = all
      .filter((r) => r.fecha >= today && isMine(r, profile))
      .sort((a, b) => (a.fecha === b.fecha ? a.slot.localeCompare(b.slot) : a.fecha.localeCompare(b.fecha)))
      .map((res) => {
        const rec = lmap.get(`${res.fecha}|${res.slot}`);
        const origin = rec ? rec.origin : 'izar4';
        const franja = fmap.get(res.slot) ?? { id: 0, slot: res.slot, start: '--:--', end: '--:--', order: 0 };
        return { res, franja, origin };
      });
    setRows(mine);
  }, [secret, today, profile]);

  useEffect(() => { void load(); }, [load]);

  async function doCancel(res: Reservation, codigo: string): Promise<boolean> {
    const r = await cancelReservation(secret, res.id, codigo);
    if (!r.ok) return false;
    await markCancelled(res.fecha, res.slot, Date.now());
    setCancelRow(null);
    await load();
    return true;
  }

  function originLabel(o: string): string {
    return o === 'app' ? t('mybookings.originApp') : o === 'auto' ? t('mybookings.originAuto') : t('mybookings.originIzar4');
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <header style={{ textAlign: 'center', padding: '12px 0', fontSize: 17, fontWeight: 700 }}>{t('mybookings.title')}</header>
      <div style={{ padding: '0 14px 8px', fontSize: 11.5, color: '#8aa0bd' }}>{t('mybookings.subtitle')}</div>
      {rows === null && <div style={{ padding: 16, color: '#8aa0bd' }}>…</div>}
      {rows && rows.length === 0 && <div style={{ padding: 16, color: '#8aa0bd' }}>{t('mybookings.empty')}</div>}
      <div style={{ padding: '0 12px' }}>
        {rows?.map(({ res, franja, origin }) => {
          const d = ymdToDate(res.fecha);
          const dateStr = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
          return (
            <div key={`${res.fecha}|${res.slot}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 8px', borderBottom: '1px solid #141d2a' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#eaf2fc' }}>{dateStr} · {franja.start}–{franja.end}</div>
                <div style={{ fontSize: 10.5, color: '#8aa0bd', marginTop: 4 }}>{originLabel(origin)}</div>
              </div>
              <button onClick={() => setCancelRow({ res, franja })}
                style={{ background: '#3a1620', color: '#ff8a8a', border: 'none', borderRadius: 10, padding: '8px 11px', fontSize: 12.5, fontWeight: 700 }}>{t('mybookings.cancel')}</button>
            </div>
          );
        })}
      </div>
      {cancelRow && (
        <CancelModal
          slot={{ franja: cancelRow.franja, status: 'ocupado', reservation: cancelRow.res } as SlotView}
          fecha={cancelRow.res.fecha} profile={profile}
          onConfirm={(codigo) => doCancel(cancelRow.res, codigo)} onClose={() => setCancelRow(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: MyBookingsScreen (upcoming mine across dates, origin badges, cancel)"
```

---

## Task 6: StatsScreen

**Files:** Create `src/screens/StatsScreen.tsx`

- [ ] **Step 1: Implement** — `src/screens/StatsScreen.tsx`

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listBookings, type BookingRecord } from '../lib/bookingsDb';
import { aggregate, periodRange, type Period } from '../lib/stats';
import { dateToYmd, ymdToDate } from '../lib/dates';

export function StatsScreen() {
  const { t, i18n } = useTranslation();
  const today = dateToYmd(new Date());
  const [period, setPeriod] = useState<Period>('month');
  const [log, setLog] = useState<BookingRecord[]>([]);

  useEffect(() => { listBookings().then(setLog).catch(() => setLog([])); }, []);

  const range = useMemo(() => periodRange(period, today), [period, today]);
  const r = useMemo(() => aggregate(log, range, today), [log, range, today]);
  const history = useMemo(
    () => log.filter((x) => x.fecha >= range.from && x.fecha <= range.to)
      .sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 20),
    [log, range],
  );

  const periods: Period[] = ['week', 'month', 'all'];
  const kpi = (n: number | string, label: string) => (
    <div style={{ flex: 1, background: '#101826', border: '1px solid #1f2b3c', borderRadius: 12, padding: '12px 6px', textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{n}</div>
      <div style={{ fontSize: 10, color: '#8aa0bd', marginTop: 2 }}>{label}</div>
    </div>
  );
  const mini = (label: string, val: string) => (
    <div style={{ flex: 1, background: '#101826', border: '1px solid #1f2b3c', borderRadius: 12, padding: '9px 11px' }}>
      <div style={{ fontSize: 10.5, color: '#8aa0bd' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{val}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <header style={{ textAlign: 'center', padding: '12px 0', fontSize: 17, fontWeight: 700 }}>{t('stats.title')}</header>
      <div style={{ display: 'flex', gap: 6, padding: '0 14px 12px' }}>
        {periods.map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            style={{ fontSize: 12, padding: '6px 11px', borderRadius: 20, border: '1px solid ' + (period === p ? '#1d4ed8' : '#1f2b3c'), background: period === p ? '#1d4ed8' : '#121b28', color: period === p ? '#fff' : '#9fb3cf' }}>
            {t(`stats.${p}`)}
          </button>
        ))}
      </div>
      <div style={{ padding: '0 14px 12px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          {kpi(r.total, t('stats.bookings'))}{kpi(r.played, t('stats.played'))}{kpi(r.cancelled, t('stats.cancelled'))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          {mini(t('stats.favourite'), r.favouriteSlot ?? t('stats.none'))}
          {mini(t('stats.autoGrabbed'), String(r.autoGrabbed))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {mini(t('stats.upcoming'), String(r.upcoming))}
          {mini(t('stats.hours'), `${r.hours.toFixed(1)} h`)}
        </div>
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#7e92ad', margin: '12px 0 7px' }}>{t('stats.history')}</div>
        {history.map((x) => {
          const d = ymdToDate(x.fecha);
          const ds = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
          return (
            <div key={x.key} style={{ display: 'flex', gap: 9, padding: '8px 2px', borderBottom: '1px solid #141d2a', fontSize: 12 }}>
              <span style={{ width: 96, color: '#cfe0f5' }}>{ds}</span>
              <span style={{ flex: 1, color: '#8aa0bd' }}>{x.start}–{x.end}</span>
              <span style={{ color: x.status === 'cancelled' ? '#ff9b9b' : x.origin === 'auto' ? '#86b7ff' : '#7ee2a8' }}>
                {x.status === 'cancelled' ? t('stats.cancelled') : x.origin === 'auto' ? t('mybookings.originAuto') : t('stats.played')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: StatsScreen (period selector default month, KPIs, history)"
```

---

## Task 7: SettingsScreen

**Files:** Create `src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Implement** — `src/screens/SettingsScreen.tsx`

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileModal } from '../components/ProfileModal';
import { setLanguage } from '../i18n';
import type { Profile } from '../lib/profile';

const LANGS: { code: 'uk' | 'en' | 'ru' | 'es'; label: string }[] = [
  { code: 'uk', label: 'Українська' }, { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' }, { code: 'es', label: 'Español' },
];

export function SettingsScreen({ profile, onProfileSaved }: { profile: Profile; onProfileSaved: (p: Profile) => void }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);

  const group: React.CSSProperties = { background: '#101826', border: '1px solid #1f2b3c', borderRadius: 14, padding: '6px 12px', margin: '0 14px 10px' };
  const item: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #141d2a', fontSize: 13 };
  const label: React.CSSProperties = { fontSize: 10.5, textTransform: 'uppercase', color: '#7e92ad', margin: '8px 14px 7px' };

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <header style={{ textAlign: 'center', padding: '12px 0', fontSize: 17, fontWeight: 700 }}>{t('settings.title')}</header>

      <div style={label}>{t('settings.profile')}</div>
      <div style={group}>
        <div style={item}><span>{t('profile.name')}</span><b>{profile.nombre}</b></div>
        <div style={item}><span>{t('profile.apartment')}</span><b>{profile.vivienda}</b></div>
        <div style={{ ...item, borderBottom: 'none' }}>
          <span>{t('profile.cancelCode')}</span>
          <button onClick={() => setEditing(true)} style={{ border: 'none', background: 'transparent', color: '#86b7ff', fontSize: 12.5 }}>{profile.codigo} · {t('settings.editProfile')} ›</button>
        </div>
      </div>

      <div style={label}>{t('settings.language')}</div>
      <div style={group}>
        {LANGS.map((l, i) => (
          <div key={l.code} style={{ ...item, borderBottom: i === LANGS.length - 1 ? 'none' : item.borderBottom }}>
            <span>{l.label}</span>
            <input type="radio" name="lang" checked={i18n.language === l.code} onChange={() => setLanguage(l.code)} />
          </div>
        ))}
      </div>

      <div style={label}>{t('settings.limits')}</div>
      <div style={group}>
        <div style={{ ...item, borderBottom: 'none' }}><span>{t('settings.limits')}</span><b>{t('settings.limitsValue')}</b></div>
      </div>

      {editing && (
        <ProfileModal initial={profile} mode="edit"
          onSave={(p) => { onProfileSaved(p); setEditing(false); }} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: SettingsScreen (profile edit, language switch, limits info)"
```

---

## Task 8: App shell with tab navigation + install banner

**Files:** Modify `src/App.tsx`; modify `src/screens/SlotsScreen.tsx` (lift profile + add My-bookings entry chip → optional)

- [ ] **Step 1: Replace `src/App.tsx`**

```tsx
import { useState } from 'react';
import { NavBar, type Tab } from './components/NavBar';
import { InstallBanner } from './components/InstallBanner';
import { SlotsScreen } from './screens/SlotsScreen';
import { MyBookingsScreen } from './screens/MyBookingsScreen';
import { StatsScreen } from './screens/StatsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { loadProfile, isProfileComplete, type Profile } from './lib/profile';
import { ProfileModal } from './components/ProfileModal';
import { saveProfile } from './lib/profile';

export default function App() {
  const [tab, setTab] = useState<Tab>('slots');
  const [profile, setProfile] = useState<Profile | null>(loadProfile());
  const need = !isProfileComplete(profile);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <InstallBanner />
      <div style={{ flex: 1 }}>
        {tab === 'slots' && <SlotsScreen />}
        {tab === 'mybookings' && (profile ? <MyBookingsScreen profile={profile} /> : null)}
        {tab === 'stats' && <StatsScreen />}
        {tab === 'settings' && profile && <SettingsScreen profile={profile} onProfileSaved={(p) => setProfile(p)} />}
      </div>
      <NavBar tab={tab} onChange={setTab} />
      {need && (
        <ProfileModal initial={profile} mode="fill"
          onSave={(p) => { saveProfile(p); setProfile(p); }} />
      )}
    </div>
  );
}
```

Note: `SlotsScreen` keeps its own profile load (for the weekly chip + booking). The fill-modal here ensures a profile exists app-wide before My bookings/Settings render. `SlotsScreen`'s own `needProfile` modal still works as a fallback but won't double-show because App's fill modal saves to the same `localStorage` key (SlotsScreen reads it on mount). To avoid a brief double prompt, this is acceptable for v1; a later refactor can lift profile to context.

- [ ] **Step 2: Typecheck + tests + build**

Run: `npx tsc --noEmit` (clean), `npx vitest run` (all green incl. stats), `npm run build` (manifest + sw.js).

- [ ] **Step 3: Manual smoke test (two terminals)**

`npm run worker:dev` + devtools secret + `npm run dev`. Expected: tab bar switches Slots/My bookings/Stats/Settings; install banner shows (or hidden if standalone/dismissed); My bookings lists your upcoming bookings with origin; Stats shows month KPIs from your booking log; Settings edits profile + switches language live.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: tab navigation shell + install banner; wire all screens"
```

---

## Self-Review

**Spec coverage (Phase 2b):**
- Bottom tab nav (Slots/My bookings/Stats/Settings) ✓ Tasks 4, 8.
- My bookings: upcoming, matched by vivienda+name, origin badges (app/auto/izar4), cancel reusing CancelModal ✓ Task 5.
- Stats: period selector default month, KPIs (bookings/played/cancelled/upcoming/auto/hours/favourite), history ✓ Tasks 1, 6.
- Settings: profile edit, language switch, limits read-only ✓ Task 7.
- Install banner: Android one-tap (`beforeinstallprompt`), iOS instructions, dismissible, standalone-hidden ✓ Task 3 (offer policy; the hard gate for push is Phase 3).
- i18n keys (uk default) ✓ Task 2.
- **Deferred to Phase 3:** auto-grab "🎯" + watchlist; notification settings; permission gating; the install *hard-gate* for notifications; `autoGrabbed`/auto-origin populate once Phase 3 lands (now always 0/izar4|app).

**Placeholder scan:** None. `custom` Period is defined in the type and `periodRange` but the UI offers week/month/all only (custom range UI deferred — not a placeholder, the enum value is simply unused in the picker for now).

**Type consistency:** `Period`, `StatsResult`, `BookingRecord`, `Reservation`, `Franja`, `SlotView`, `Profile`, `Tab` consistent. `CancelModal` reused with a constructed `SlotView` (franja+reservation) — matches its prop type. `MyBookingsScreen`/`SettingsScreen` take `profile`; `App` passes it.

**Note:** the App-level fill modal + SlotsScreen's own profile state are mildly redundant; acceptable for v1, flagged for a future profile-context refactor.
