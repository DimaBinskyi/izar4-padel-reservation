import { useCallback, useEffect, useState } from 'react';
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
  createReservation, cancelReservation,
} from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { dateToYmd, addDays } from '../lib/dates';
import { loadProfile, saveProfile, isProfileComplete, type Profile } from '../lib/profile';
import { isMine } from '../lib/mine';
import { countDay, weeklyRemaining, countWeek } from '../lib/limits';
import { recordBooking, markCancelled, bookingKey } from '../lib/bookingsDb';
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
  const { t } = useTranslation();
  const today = dateToYmd(new Date());
  const [selected, setSelected] = useState(today);

  // All data is fetched up front (reservations for every date come from the cron snapshot); the
  // selected day's slots are derived from it. We re-fetch silently on each day change / write.
  const [allRes, setAllRes] = useState<Reservation[]>([]);
  const [franjas, setFranjas] = useState<Franja[]>([]);
  const [weekdayBlocks, setWeekdayBlocks] = useState<WeekdayBlockSet>({});
  const [dayBlocks, setDayBlocks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const ready = franjas.length > 0;   // first load finished → real data to show

  const [profile, setProfile] = useState<Profile | null>(loadProfile());
  const [editingProfile, setEditingProfile] = useState(false);
  const [bookSlot, setBookSlot] = useState<SlotView | null>(null);
  const [cancelSlot, setCancelSlot] = useState<SlotView | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [highlightSlot, setHighlightSlot] = useState<string | null>(null);

  const secret = getDeviceSecret();
  const needProfile = !isProfileComplete(profile);

  const load = useCallback(async (live = false) => {
    setError(null);
    try {
      const f = await fetchFranjas(secret);          // session-cached
      const wb = await fetchWeekdayBlocks(secret);    // session-cached
      const all = applyOverrides(await fetchAllReservations(secret, live));
      const db = await fetchDayBlocks(secret);        // worker-cached
      setFranjas(f); setWeekdayBlocks(wb); setAllRes(all); setDayBlocks(db);
    } catch { setError(t('slots.error')); }
  }, [secret, t]);

  useEffect(() => { void load(); }, [load]);   // instant: render from the snapshot

  // Refresh from the snapshot when the app/tab regains focus. The snapshot is kept current by the
  // cron AND by the Worker patching it on every app booking/cancel, so this stays consistent with
  // the user's own actions. (We deliberately do NOT auto-fetch live izar4 here: its read-after-write
  // lag can momentarily drop a just-made booking, which mis-counted the weekly limit. Pull-to-refresh
  // is the explicit "fetch live now" action.)
  useEffect(() => {
    const reconcile = () => { if (document.visibilityState === 'visible') void load(false); };
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('focus', reconcile);
    return () => {
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('focus', reconcile);
    };
  }, [load]);

  // Jump to a slot (from My bookings): switch date, refresh, then blink it for 3s.
  // Snapshot read (not live) — all dates are already in `allRes`, and overrides keep recent
  // actions correct; a live refetch here is slow and can poison the snapshot on a WAF 503.
  useEffect(() => {
    if (focus) { setSelected(focus.fecha); setHighlightSlot(focus.slot); void load(); onFocusConsumed?.(); }
  }, [focus, onFocusConsumed, load]);
  useEffect(() => {
    if (!highlightSlot) return;
    const id = window.setTimeout(() => setHighlightSlot(null), 3000);
    return () => window.clearTimeout(id);
  }, [highlightSlot]);

  const remaining = profile ? weeklyRemaining(allRes, profile.vivienda, selected, WEEKLY_LIMIT) : WEEKLY_LIMIT;
  const beyondHorizon = selected > addDays(today, BOOKING_HORIZON_DAYS);

  function goToDate(d: string) {
    setSelected(d);
    setHighlightSlot(null);
    // Snapshot refresh only. The snapshot already holds every date, so the new day renders
    // instantly from `allRes`; forcing a live izar4 fetch here is slow and risks overwriting
    // the snapshot with an empty result when izar4's WAF 503s (slots would then show empty).
    void load();
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
    await load();                // refresh from the snapshot (worker patched it on the write) — fast,
    setBookSlot(null);           // and real: the modal closes only after the confirmed state is loaded
  }

  async function doCancel(slot: SlotView, codigo: string): Promise<boolean> {
    const id = slot.reservation!.id;
    const r = await cancelReservation(secret, id, codigo);
    if (!r.ok) return false;
    await markCancelled(selected, slot.franja.slot, Date.now());
    addRecentAction(selected, slot.franja.slot);
    addOverride({ key: bookingKey(selected, slot.franja.slot), type: 'remove' });
    void syncRegistration();
    await load();                // snapshot refresh (worker patched it on the cancel) — fast + real
    setCancelSlot(null);
    return true;
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
      <PullToRefresh onRefresh={() => load(true)}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
        <button aria-label="watch" onClick={() => setWatchOpen(true)}
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
            onBook={() => tryBook(s)} onCancel={() => setCancelSlot(s)} onWatch={() => setWatchOpen(true)} />
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
      {watchOpen && <WatchSheet fecha={selected} franjas={franjas} onClose={() => setWatchOpen(false)} />}
    </div>
  );
}
