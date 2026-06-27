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
  const [error, setError] = useState<string | null>(null);
  const [cancelRow, setCancelRow] = useState<{ res: Reservation; franja: Franja } | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
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
    } catch {
      setError(t('slots.error'));
    }
  }, [secret, today, profile, t]);

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
      {error && <div style={{ padding: 16, color: '#ff9b9b' }}>{error}</div>}
      {!error && rows === null && <div style={{ padding: 16, color: '#8aa0bd' }}>…</div>}
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
