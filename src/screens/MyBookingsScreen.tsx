import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CancelModal } from '../components/CancelModal';
import { fetchAllReservations, fetchFranjas, cancelReservation } from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { listBookings, markCancelled, bookingKey, type BookingRecord } from '../lib/bookingsDb';
import { buildBookingEvent } from '../lib/ics';
import { addBookingToCalendar } from '../lib/calendar';
import { hasCalendarEvent, clearCalendarEvent } from '../lib/calendarEvents';
import { Toast, useToast } from '../components/Toast';
import { addRecentAction } from '../lib/recentActions';
import { applyOverrides, addOverride } from '../lib/overrides';
import { syncRegistration } from '../lib/pushClient';
import { isMine } from '../lib/mine';
import { PullToRefresh } from '../components/PullToRefresh';
import { dateToYmd, ymdToDate } from '../lib/dates';
import type { Profile } from '../lib/profile';
import type { Franja, Reservation, SlotView } from '../lib/types';

export function MyBookingsScreen({ profile, onOpenSlot }: { profile: Profile; onOpenSlot: (fecha: string, slot: string) => void }) {
  const { t, i18n } = useTranslation();
  const { toast, show } = useToast();
  const today = dateToYmd(new Date());
  const secret = getDeviceSecret();
  const [rows, setRows] = useState<{ res: Reservation; franja: Franja; origin: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelRow, setCancelRow] = useState<{ res: Reservation; franja: Franja } | null>(null);

  const load = useCallback(async (live = false) => {
    if (!live) { setRows(null); setError(null); }   // only show the skeleton on the instant (snapshot) pass
    try {
      const [allRaw, franjas, log] = await Promise.all([fetchAllReservations(secret, live), fetchFranjas(secret), listBookings()]);
      const all = applyOverrides(allRaw.reservas);
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
      if (!live) setError(t('slots.error'));
    }
  }, [secret, today, profile, t]);

  useEffect(() => { void load(); }, [load]);   // instant: render from the snapshot

  // Refresh from the snapshot on focus (snapshot is kept current by the cron + Worker write-patches).
  // Live izar4 is fetched only on explicit pull-to-refresh (its read-after-write lag is unreliable).
  useEffect(() => {
    const reconcile = () => { if (document.visibilityState === 'visible') void load(false); };
    document.addEventListener('visibilitychange', reconcile);
    window.addEventListener('focus', reconcile);
    return () => {
      document.removeEventListener('visibilitychange', reconcile);
      window.removeEventListener('focus', reconcile);
    };
  }, [load]);

  function addToCalendar(res: Reservation, franja: Franja) {
    if (franja.start === '--:--') { show(t('calendar.error'), 'warn'); return; }
    const key = bookingKey(res.fecha, res.slot);
    const ev = buildBookingEvent(
      { fecha: res.fecha, slot: res.slot, start: franja.start, end: franja.end },
      {
        title: t('calendar.eventTitle'),
        location: t('calendar.eventLocation'),
        description: `${res.slot} · ${franja.start}–${franja.end} · ${res.nombre} · ${res.vivienda}`,
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

  async function doCancel(res: Reservation, codigo: string): Promise<boolean> {
    const r = await cancelReservation(secret, res.id, codigo);
    if (!r.ok) return false;
    await markCancelled(res.fecha, res.slot, Date.now());
    addRecentAction(res.fecha, res.slot);
    addOverride({ key: `${res.fecha}|${res.slot}`, type: 'remove' });
    void syncRegistration();
    await load(true);            // direct live re-read from izar4 + feed the Worker
    const calKey = bookingKey(res.fecha, res.slot);
    if (hasCalendarEvent(calKey)) {
      show(t('calendar.cancelReminder'), 'warn');
      clearCalendarEvent(calKey);
    }
    setCancelRow(null);
    return true;
  }

  function originLabel(o: string): string {
    return o === 'app' ? t('mybookings.originApp') : o === 'auto' ? t('mybookings.originAuto') : t('mybookings.originIzar4');
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <PullToRefresh onRefresh={() => load(true)}>
      <header style={{ textAlign: 'center', padding: '12px 0', fontSize: 17, fontWeight: 700 }}>{t('mybookings.title')}</header>
      <div style={{ padding: '0 14px 8px', fontSize: 11.5, color: '#8aa0bd' }}>{t('mybookings.subtitle')}</div>
      {error && <div style={{ padding: 16, color: '#ff9b9b' }}>{error}</div>}
      {!error && rows === null && <div style={{ padding: 16, color: '#8aa0bd' }}>…</div>}
      {rows && rows.length === 0 && <div style={{ padding: 16, color: '#8aa0bd' }}>{t('mybookings.empty')}</div>}
      <div style={{ padding: '0 12px' }}>
        {rows?.map(({ res, franja, origin }) => {
          const d = ymdToDate(res.fecha);
          const dateStr = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
          const startedToday = res.fecha === today && franja.start !== '--:--' && franja.start <= new Date().toTimeString().slice(0, 5);
          return (
            <div key={`${res.fecha}|${res.slot}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 8px', borderBottom: '1px solid #141d2a' }}>
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => onOpenSlot(res.fecha, res.slot)}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#eaf2fc' }}>{dateStr} · {franja.start}–{franja.end}</div>
                <div style={{ fontSize: 10.5, color: '#8aa0bd', marginTop: 4 }}>{originLabel(origin)}</div>
              </div>
              {!startedToday && (
                <button onClick={() => addToCalendar(res, franja)} aria-label={t('calendar.add')}
                  style={{ background: '#16202e', color: '#cfe0f5', border: 'none', borderRadius: 10, padding: '8px 11px', fontSize: 15, fontWeight: 700 }}>📅</button>
              )}
              <button onClick={() => setCancelRow({ res, franja })}
                style={{ background: '#3a1620', color: '#ff8a8a', border: 'none', borderRadius: 10, padding: '8px 11px', fontSize: 12.5, fontWeight: 700 }}>{t('mybookings.cancel')}</button>
            </div>
          );
        })}
      </div>
      </PullToRefresh>
      {cancelRow && (
        <CancelModal
          slot={{ franja: cancelRow.franja, status: 'ocupado', reservation: cancelRow.res } as SlotView}
          fecha={cancelRow.res.fecha} profile={profile}
          onConfirm={(codigo) => doCancel(cancelRow.res, codigo)} onClose={() => setCancelRow(null)} />
      )}
      <Toast toast={toast} />
    </div>
  );
}
