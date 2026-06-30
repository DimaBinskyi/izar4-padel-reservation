import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateStrip } from '../components/DateStrip';
import { SlotRow } from '../components/SlotRow';
import { ProfileModal } from '../components/ProfileModal';
import { BookingModal } from '../components/BookingModal';
import { CancelModal } from '../components/CancelModal';
import { WatchSheet } from '../components/WatchSheet';
import { Spinner } from '../components/Spinner';
import { PullToRefresh } from '../components/PullToRefresh';
import { deriveSlots } from '../lib/status';
import {
  fetchFranjas, fetchAllReservations, fetchWeekdayBlocks, fetchDayBlocks,
  createReservation, cancelReservation, clearStaticCaches,
} from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { dateToYmd, addDays } from '../lib/dates';
import { loadProfile, saveProfile, isProfileComplete, type Profile } from '../lib/profile';
import { isMine } from '../lib/mine';
import { countDay, weeklyRemaining, countWeek } from '../lib/limits';
import { recordBooking, markCancelled, bookingKey } from '../lib/bookingsDb';
import { buildBookingEvent } from '../lib/ics';
import { addBookingToCalendar } from '../lib/calendar';
import { hasCalendarEvent, clearCalendarEvent } from '../lib/calendarEvents';
import { Toast, useToast } from '../components/Toast';
import { addRecentAction } from '../lib/recentActions';
import { applyOverrides, addOverride } from '../lib/overrides';
import { syncRegistration } from '../lib/pushClient';
import { WEEKLY_LIMIT, DAILY_LIMIT, BOOKING_HORIZON_DAYS } from '../config';
import type { Franja, Reservation, SlotView, WeekdayBlockSet } from '../lib/types';

interface SlotsScreenProps {
  focus?: { fecha: string; slot: string } | null;   // jump to + blink a slot (from My bookings)
  onFocusConsumed?: () => void;
}

export function SlotsScreen({ focus = null, onFocusConsumed }: SlotsScreenProps = {}) {
  const { t, i18n } = useTranslation();
  const { toast, show } = useToast();
  const today = dateToYmd(new Date());
  const [selected, setSelected] = useState(today);

  // izar4 returns ALL reservations in one request, so `allRes` already holds every day. Switching
  // days re-derives instantly from it (no per-day fetch, no spinner); we refresh it live in the
  // BACKGROUND on landing/focus so the data stays current without ever blocking the UI. The weekly
  // limit is counted from the same data.
  const [allRes, setAllRes] = useState<Reservation[]>([]);
  const [franjas, setFranjas] = useState<Franja[]>([]);
  const [weekdayBlocks, setWeekdayBlocks] = useState<WeekdayBlockSet>({});
  const [dayBlocks, setDayBlocks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);   // a refresh is in flight → show the "syncing" pill
  const [isFresh, setIsFresh] = useState(false);         // shown data was pulled live (vs the snapshot/cache)
  const [snapshotTs, setSnapshotTs] = useState(0);       // when the shown snapshot was made (ms epoch)
  const loadSeq = useRef(0);                       // drop out-of-order responses (rapid day taps / refreshes)
  const ready = franjas.length > 0;   // first load finished → real data to show

  const [profile, setProfile] = useState<Profile | null>(loadProfile());
  const [editingProfile, setEditingProfile] = useState(false);
  const [bookSlot, setBookSlot] = useState<SlotView | null>(null);
  const [cancelSlot, setCancelSlot] = useState<SlotView | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [watchSlot, setWatchSlot] = useState<string | null>(null);   // slot to pre-select in the watch sheet (null = full day)
  const [highlightSlot, setHighlightSlot] = useState<string | null>(null);

  const secret = getDeviceSecret();
  const needProfile = !isProfileComplete(profile);

  // `live` → fresh from izar4, else the fast snapshot. A sequence guard drops responses superseded
  // by a newer load so the list never shows stale data after rapid day taps / overlapping refreshes.
  // Read reservations + static data and apply them. `live` → force-fresh from izar4 (pull-to-refresh);
  // otherwise the fast snapshot, which the Worker keeps fresh in the background (stale-while-revalidate).
  // A sequence guard drops responses superseded by a newer load so the list never shows a stale day.
  const load = useCallback(async (live = false) => {
    const seq = ++loadSeq.current;
    setError(null);
    try {
      // Fetch the four endpoints in parallel: they're independent, the Worker KV-caches the static
      // ones (franjas/blocks) so concurrent calls mostly hit our edge — not izar4 — and the Worker
      // retries any rare WAF 503. Cold-load wall-clock drops from the sum (~2.5s) to ~one request.
      const [f, wb, allRaw, db] = await Promise.all([
        fetchFranjas(secret),
        fetchWeekdayBlocks(secret),
        fetchAllReservations(secret, live),
        fetchDayBlocks(secret),
      ]);
      if (seq !== loadSeq.current) return;            // a newer load started → drop this stale result
      setFranjas(f); setWeekdayBlocks(wb); setAllRes(applyOverrides(allRaw.reservas)); setDayBlocks(db); setSnapshotTs(allRaw.ts);
    } catch { if (seq === loadSeq.current) setError(t('slots.error')); }
  }, [secret, t]);

  // Live refresh: fetch DIRECTLY from izar4 (the user's fast IP — bypasses the WAF-throttled Worker)
  // and feed the result to the Worker so its snapshot stays fresh.
  const forceLive = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false); setIsFresh(true);
  }, [load]);

  // Pull-to-refresh: also drop the static caches (slots + weekday/date blocks) so EVERYTHING re-pulls
  // fresh from izar4, then the live reservation fetch feeds the Worker's snapshot (inside load(true)).
  const pullRefresh = useCallback(async () => {
    clearStaticCaches();
    await forceLive();
  }, [forceLive]);

  // On open: render the Worker snapshot instantly (fast cache, with its "cached · HH:MM" time), then
  // pull live current data directly from izar4 (user IP, ~fast) and replace it.
  useEffect(() => { void (async () => { await load(false); await forceLive(); })(); }, [load, forceLive]);

  // Re-fetch live (direct) when the app/tab regains focus.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void forceLive(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [forceLive]);

  // Jump to a slot (from My bookings): switch date (instant from allRes), refresh live, blink 3s.
  useEffect(() => {
    if (focus) { setSelected(focus.fecha); setHighlightSlot(focus.slot); void forceLive(); onFocusConsumed?.(); }
  }, [focus, onFocusConsumed, forceLive]);
  useEffect(() => {
    if (!highlightSlot) return;
    const id = window.setTimeout(() => setHighlightSlot(null), 3000);
    return () => window.clearTimeout(id);
  }, [highlightSlot]);

  const remaining = profile ? weeklyRemaining(allRes, profile.vivienda, selected, WEEKLY_LIMIT) : WEEKLY_LIMIT;
  const beyondHorizon = selected > addDays(today, BOOKING_HORIZON_DAYS);

  function goToDate(d: string) {
    setSelected(d);          // instant from in-memory allRes (it already holds every day; no fetch)
    setHighlightSlot(null);
  }

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
    addRecentAction(selected, slot.franja.slot);
    addOverride({ key: bookingKey(selected, slot.franja.slot), type: 'add', res: { id: r.id ?? 0, slot: slot.franja.slot, fecha: selected, nombre: profile.nombre, vivienda: profile.vivienda.toUpperCase() } });
    void syncRegistration();
    await forceLive();           // direct live re-read from izar4 + feed the Worker (override bridges the write lag)
    setBookSlot(null);           // modal closes only after the confirmed state is loaded
  }

  async function doCancel(slot: SlotView, codigo: string): Promise<boolean> {
    const id = slot.reservation!.id;
    const r = await cancelReservation(secret, id, codigo);
    if (!r.ok) return false;
    await markCancelled(selected, slot.franja.slot, Date.now());
    addRecentAction(selected, slot.franja.slot);
    addOverride({ key: bookingKey(selected, slot.franja.slot), type: 'remove' });
    void syncRegistration();
    await forceLive();           // direct live re-read from izar4 + feed the Worker
    const calKey = bookingKey(selected, slot.franja.slot);
    if (hasCalendarEvent(calKey)) {
      show(t('calendar.cancelReminder'), 'warn');
      clearCalendarEvent(calKey);
    }
    setCancelSlot(null);
    return true;
  }

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

  function tryBook(slot: SlotView) {
    if (!profile) { setEditingProfile(true); return; }
    if (beyondHorizon) { alert(t('slots.viewOnlyBeyondHorizon')); return; }
    if (countDay(allRes, profile.vivienda, selected) >= DAILY_LIMIT) { alert(t('booking.limitReachedDay')); return; }
    if (countWeek(allRes, profile.vivienda, selected) >= WEEKLY_LIMIT) { alert(t('booking.limitReachedWeek', { limit: WEEKLY_LIMIT })); return; }
    setBookSlot(slot);
  }

  const slots = ready
    ? deriveSlots({ fecha: selected, franjas, reservations: allRes.filter((r) => r.fecha === selected), weekdayBlocks, dayBlocked: false, now: new Date() })
    : [];

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <PullToRefresh onRefresh={pullRefresh}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
        <button aria-label="watch" onClick={() => { setWatchSlot(null); setWatchOpen(true); }}
          style={{ border: 'none', background: '#16202e', color: '#cfe0f5', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>🎯 {t('watch.title')}</button>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{t('app.title')}</span>
        <button aria-label="profile" onClick={() => setEditingProfile(true)}
          style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: '#16202e', color: '#cfe0f5' }}>⚙️</button>
      </header>

      {profile && (
        <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
          <span style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 20, background: '#10261a', color: '#7ee2a8' }}>{remaining}/{WEEKLY_LIMIT}</span>
          <span style={{ fontSize: 11.5, padding: '4px 9px', borderRadius: 20, background: '#101a2b', color: '#86b7ff' }}>{profile.vivienda} · {profile.nombre}</span>
        </div>
      )}

      <DateStrip todayYmd={today} selected={selected} onSelect={goToDate} />

      {ready && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 6px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, padding: '3px 10px', borderRadius: 20,
            background: refreshing ? '#10261a' : isFresh ? '#101a2b' : '#241a00',
            color: refreshing ? '#7ee2a8' : isFresh ? '#86b7ff' : '#f2c14e' }}>
            {refreshing && <span style={{ display: 'inline-flex', transform: 'scale(0.65)' }}><Spinner /></span>}
            {refreshing ? t('slots.refreshing')
              : `${isFresh ? t('slots.updated') : t('slots.cached')}${snapshotTs ? ` · ${new Date(snapshotTs).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`}
          </span>
        </div>
      )}

      <div style={{ padding: '2px 10px 8px', minHeight: '60vh' }}>
        {error && <div style={{ padding: 16, color: '#ff9b9b' }}>{error}</div>}
        {!error && !ready && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0', color: '#8aa0bd' }}><Spinner /></div>
        )}
        {!error && ready && dayBlocks[selected] !== undefined && (
          <div style={{ padding: 16, color: '#f2c14e' }}>{dayBlocks[selected] || t('slots.dayBlocked')}</div>
        )}
        {!error && ready && dayBlocks[selected] === undefined && slots.map((s) => (
          <SlotRow key={s.franja.slot} slot={s}
            mine={!!(s.reservation && profile && isMine(s.reservation, profile))}
            canBook={!beyondHorizon}
            highlight={highlightSlot === s.franja.slot}
            onBook={() => tryBook(s)} onCancel={() => setCancelSlot(s)} onWatch={() => { setWatchSlot(s.franja.slot); setWatchOpen(true); }}
            onAddCalendar={() => addToCalendar(s)} />
        ))}
      </div>
      </PullToRefresh>

      {(needProfile || editingProfile) && (
        <ProfileModal initial={profile} mode={needProfile ? 'fill' : 'edit'}
          onSave={(p) => { saveProfile(p); setProfile(p); setEditingProfile(false); }}
          onClose={needProfile ? undefined : () => setEditingProfile(false)} />
      )}
      {bookSlot && profile && (
        <BookingModal slot={bookSlot} fecha={selected} profile={profile}
          weeklyRemainingAfter={Math.max(0, WEEKLY_LIMIT - (countWeek(allRes, profile.vivienda, selected) + 1))}
          onConfirm={() => doBook(bookSlot)} onClose={() => setBookSlot(null)} />
      )}
      {cancelSlot && profile && cancelSlot.reservation && (
        <CancelModal slot={cancelSlot} fecha={selected} profile={profile}
          onConfirm={(codigo) => doCancel(cancelSlot, codigo)} onClose={() => setCancelSlot(null)} />
      )}
      {watchOpen && <WatchSheet fecha={selected} franjas={franjas} reservations={allRes} vivienda={profile?.vivienda ?? ''} initialSlot={watchSlot} onClose={() => setWatchOpen(false)} />}
      <Toast toast={toast} />
    </div>
  );
}
