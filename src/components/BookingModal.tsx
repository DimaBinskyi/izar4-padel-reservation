import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Profile } from '../lib/profile';
import type { SlotView } from '../lib/types';
import { ymdToDate } from '../lib/dates';
import { weekRange } from '../lib/limits';
import { WEEKLY_LIMIT } from '../config';
import { Spinner } from './Spinner';

interface Props {
  slot: SlotView;
  fecha: string;
  profile: Profile;
  weeklyRemainingAfter: number;   // weekly bookings that would remain after this one (matches the header's remaining badge)
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 };
const sheet: React.CSSProperties = { width: '100%', maxWidth: 420, background: '#101826', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: '1px solid #243246', padding: '14px 16px 18px' };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 };

export function BookingModal({ slot, fecha, profile, weeklyRemainingAfter, onConfirm, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = ymdToDate(fecha);
  const dateStr = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  // The weekly limit is counted in the BOOKING's Mon–Sun week, not "today's" week. Show that range
  // explicitly so a next-week booking doesn't look like it's counting the current week.
  const { monday, sunday } = weekRange(fecha);
  const fmtShort = (ymd: string) => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(ymdToDate(ymd));
  const weekStr = `${fmtShort(monday)} – ${fmtShort(sunday)}`;

  async function go() {
    setBusy(true); setError(null);
    try { await onConfirm(); } catch { setError(t('booking.error')); setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('booking.title')}</h3>
        <div style={{ background: '#0b1320', border: '1px solid #1e2a3c', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.resource')}</span><b>Pádel</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.date')}</span><b>{dateStr}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.slot')}</span><b>{slot.franja.start} – {slot.franja.end}</b></div>
        </div>
        <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#7e92ad', margin: '4px 0 6px' }}>{t('booking.bookingAs')}</div>
        <div style={{ background: '#0b1320', border: '1px solid #21304a', borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('profile.name')}</span><b>{profile.nombre}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('profile.apartment')}</span><b>{profile.vivienda}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('profile.cancelCode')}</span><b style={{ fontFamily: 'monospace' }}>{profile.codigo}</b></div>
        </div>
        <div style={{ fontSize: 12, color: '#7ee2a8', margin: '0 0 12px' }}>
          {t('booking.afterWeekly', { n: weeklyRemainingAfter, limit: WEEKLY_LIMIT, week: weekStr })}
        </div>
        {error && <div style={{ fontSize: 12, color: '#ff9b9b', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }} onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, opacity: busy ? 0.6 : 1 }} onClick={go} disabled={busy}>{busy ? <Spinner /> : t('common.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
