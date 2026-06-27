import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateStrip } from '../components/DateStrip';
import { SlotRow } from '../components/SlotRow';
import { ProfileModal } from '../components/ProfileModal';
import { BookingModal } from '../components/BookingModal';
import { CancelModal } from '../components/CancelModal';
import { WatchSheet } from '../components/WatchSheet';
import { deriveSlots } from '../lib/status';
import {
  fetchFranjas, fetchAllReservations, fetchWeekdayBlocks, fetchDayBlock,
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
import type { Franja, Reservation, SlotView } from '../lib/types';

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
  const [franjas, setFranjas] = useState<Franja[]>([]);
  const [watchOpen, setWatchOpen] = useState(false);

  const secret = getDeviceSecret();
  const needProfile = !isProfileComplete(profile);

  const load = useCallback(async (silent = false, live = false) => {
    if (!silent) setSlots(null);
    setError(null); setBlockedMsg(null);
    try {
      // Sequential (not Promise.all): izar4's WAF 503s on concurrent bursts. Static data is
      // session-cached in the client, so warm loads only fetch reservations + the day block.
      const franjasFetched = await fetchFranjas(secret);
      const weekdayBlocks = await fetchWeekdayBlocks(secret);
      const allReservations = applyOverrides(await fetchAllReservations(secret, live));
      const dayBlock = await fetchDayBlock(secret, selected);
      setAllRes(allReservations);
      setFranjas(franjasFetched);
      if (dayBlock) { setBlockedMsg(dayBlock.motivo || t('slots.dayBlocked')); setSlots([]); return; }
      const reservations = allReservations.filter((r) => r.fecha === selected);
      setSlots(deriveSlots({ fecha: selected, franjas: franjasFetched, reservations, weekdayBlocks, dayBlocked: false, now: new Date() }));
    } catch { setError(t('slots.error')); }
  }, [secret, selected, t]);

  useEffect(() => { void load(); }, [load]);

  const remaining = profile ? weeklyRemaining(allRes, profile.vivienda, selected, WEEKLY_LIMIT) : WEEKLY_LIMIT;
  const beyondHorizon = selected > addDays(today, BOOKING_HORIZON_DAYS);

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
    await load(true, true);   // overrides keep this correct despite read-after-write lag
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
    await load(true, true);   // overrides keep the counter/slots correct despite read-after-write lag
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

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
        <button aria-label="watch" onClick={() => setWatchOpen(true)}
          style={{ height: 30, padding: '0 9px', borderRadius: 8, border: 'none', background: '#16202e', color: '#f2c14e', fontSize: 12.5 }}>🎯 {t('watch.title')}</button>
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
            canBook={!beyondHorizon}
            onBook={() => tryBook(s)} onCancel={() => setCancelSlot(s)} onWatch={() => setWatchOpen(true)} />
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
      {watchOpen && <WatchSheet fecha={selected} franjas={franjas} onClose={() => setWatchOpen(false)} />}
    </div>
  );
}
