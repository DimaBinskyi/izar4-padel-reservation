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
