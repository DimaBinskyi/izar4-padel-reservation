import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateStrip } from '../components/DateStrip';
import { SlotRow } from '../components/SlotRow';
import { ProfileModal } from '../components/ProfileModal';
import { BookingModal } from '../components/BookingModal';
import { CancelModal } from '../components/CancelModal';
import { WatchSheet } from '../components/WatchSheet';
import { Spinner } from '../components/Spinner';
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
import { WEEKLY_LIMIT, DAILY_LIMIT, BOOKING_HORIZON_DAYS, CALENDAR_DAYS } from '../config';
import type { Franja, Reservation, SlotView, WeekdayBlockSet } from '../lib/types';

interface SlotsScreenProps {
  focus?: { fecha: string; slot: string } | null;   // jump to + blink a slot (from My bookings)
  onFocusConsumed?: () => void;
}

const SLIDE = 'transform .32s cubic-bezier(.22,.61,.36,1)';

export function SlotsScreen({ focus = null, onFocusConsumed }: SlotsScreenProps = {}) {
  const { t } = useTranslation();
  const today = dateToYmd(new Date());
  const maxYmd = addDays(today, CALENDAR_DAYS - 1);
  const [selected, setSelected] = useState(today);

  // All data is fetched up front (reservations for every date come from the cron snapshot), so the
  // adjacent day-pages are already available during a swipe. We re-fetch (silently) on each change.
  const [allRes, setAllRes] = useState<Reservation[]>([]);
  const [franjas, setFranjas] = useState<Franja[]>([]);
  const [weekdayBlocks, setWeekdayBlocks] = useState<WeekdayBlockSet>({});
  const [dayBlocks, setDayBlocks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const ready = franjas.length > 0;   // first load finished → pages have data to show

  const [profile, setProfile] = useState<Profile | null>(loadProfile());
  const [editingProfile, setEditingProfile] = useState(false);
  const [bookSlot, setBookSlot] = useState<SlotView | null>(null);
  const [cancelSlot, setCancelSlot] = useState<SlotView | null>(null);
  const [watchOpen, setWatchOpen] = useState(false);
  const [highlightSlot, setHighlightSlot] = useState<string | null>(null);

  // Carousel: the track is driven imperatively (no setState per touchmove) for a smooth full slide.
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragXRef = useRef(0);

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

  useEffect(() => { void load(); }, [load]);

  // Jump to a slot (from My bookings): switch date, refresh, then blink it for 3s.
  useEffect(() => {
    if (focus) { setSelected(focus.fecha); setHighlightSlot(focus.slot); void load(true); onFocusConsumed?.(); }
  }, [focus, onFocusConsumed, load]);
  useEffect(() => {
    if (!highlightSlot) return;
    const id = window.setTimeout(() => setHighlightSlot(null), 3000);
    return () => window.clearTimeout(id);
  }, [highlightSlot]);

  // Center the track on the selected day (instantly) whenever the day changes or on first render.
  function setTrack(px: number, animate: boolean) {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? SLIDE : 'none';
    el.style.transform = `translateX(calc(-100% + ${px}px))`;
  }
  useLayoutEffect(() => { setTrack(0, false); }, [selected, ready]);

  const remaining = profile ? weeklyRemaining(allRes, profile.vivienda, selected, WEEKLY_LIMIT) : WEEKLY_LIMIT;
  const beyondHorizon = selected > addDays(today, BOOKING_HORIZON_DAYS);

  function goToDate(d: string) {
    if (d < today || d > maxYmd) return;
    setSelected(d);
    setHighlightSlot(null);
    void load(true);  // refresh on transition
  }

  // ── Carousel touch handlers (imperative track for smoothness) ──
  function onTouchStart(e: React.TouchEvent) {
    const tp = e.touches[0];
    dragStart.current = { x: tp.clientX, y: tp.clientY };
    dragXRef.current = 0;
  }
  function onTouchMove(e: React.TouchEvent) {
    const s = dragStart.current;
    if (!s) return;
    const tp = e.touches[0];
    const dx = tp.clientX - s.x, dy = tp.clientY - s.y;
    if (Math.abs(dx) < Math.abs(dy)) return;             // vertical → let it scroll
    const atStart = selected <= today && dx > 0;
    const atEnd = selected >= maxYmd && dx < 0;
    const d = atStart || atEnd ? dx * 0.3 : dx;          // rubber-band at the ends
    dragXRef.current = d;
    setTrack(d, false);
  }
  function onTouchEnd() {
    const had = dragStart.current;
    dragStart.current = null;
    if (!had) return;
    const W = viewportRef.current?.clientWidth ?? 360;
    const dx = dragXRef.current;
    dragXRef.current = 0;
    const threshold = Math.min(80, W * 0.22);
    const dir = dx < 0 ? 1 : -1;
    const target = addDays(selected, dir);
    if (Math.abs(dx) < threshold || target < today || target > maxYmd) { setTrack(0, true); return; }
    setTrack(dir < 0 ? -W : W, true);   // slide the full page out
    window.setTimeout(() => {
      setSelected(target);              // useLayoutEffect recenters instantly on the new day
      void load(true);                  // re-fetch to refresh after the transition
    }, 320);
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
    await load(true);
    setBookSlot(null);
  }

  async function doCancel(slot: SlotView, codigo: string): Promise<boolean> {
    const id = slot.reservation!.id;
    const r = await cancelReservation(secret, id, codigo);
    if (!r.ok) return false;
    await markCancelled(selected, slot.franja.slot, Date.now());
    addRecentAction(selected, slot.franja.slot);
    addOverride({ key: bookingKey(selected, slot.franja.slot), type: 'remove' });
    void syncRegistration();
    await load(true);
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

  function renderDay(date: string) {
    if (!ready) {
      return <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0', color: '#8aa0bd' }}><Spinner /></div>;
    }
    if (dayBlocks[date] !== undefined) {
      return <div style={{ padding: 16, color: '#f2c14e' }}>{dayBlocks[date] || t('slots.dayBlocked')}</div>;
    }
    const interactive = date === selected;
    const daySlots = deriveSlots({
      fecha: date, franjas, reservations: allRes.filter((r) => r.fecha === date),
      weekdayBlocks, dayBlocked: false, now: new Date(),
    });
    return daySlots.map((s) => (
      <SlotRow key={s.franja.slot} slot={s}
        mine={!!(s.reservation && profile && isMine(s.reservation, profile))}
        canBook={interactive && date <= addDays(today, BOOKING_HORIZON_DAYS)}
        highlight={interactive && highlightSlot === s.franja.slot}
        onBook={() => { if (interactive) tryBook(s); }}
        onCancel={() => { if (interactive) setCancelSlot(s); }}
        onWatch={() => { if (interactive) setWatchOpen(true); }} />
    ));
  }

  const days = [addDays(selected, -1), selected, addDays(selected, 1)];

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
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

      {error ? (
        <div style={{ padding: 16, color: '#ff9b9b' }}>{error}</div>
      ) : (
        <div ref={viewportRef} style={{ overflow: 'hidden', minHeight: '60vh' }}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <div ref={trackRef} style={{ display: 'flex', willChange: 'transform' }}>
            {days.map((date) => (
              <div key={date} style={{ flex: '0 0 100%', padding: '2px 10px 8px' }}>{renderDay(date)}</div>
            ))}
          </div>
        </div>
      )}

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
      {watchOpen && <WatchSheet fecha={selected} franjas={franjas} onClose={() => setWatchOpen(false)} />}
    </div>
  );
}
