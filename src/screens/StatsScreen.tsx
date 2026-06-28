import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listBookings, type BookingRecord } from '../lib/bookingsDb';
import { aggregate, periodRange, type Period } from '../lib/stats';
import { dateToYmd, ymdToDate } from '../lib/dates';
import { PullToRefresh } from '../components/PullToRefresh';

export function StatsScreen() {
  const { t, i18n } = useTranslation();
  const today = dateToYmd(new Date());
  const [period, setPeriod] = useState<Period>('month');
  const [log, setLog] = useState<BookingRecord[]>([]);

  const loadLog = useCallback(async () => { try { setLog(await listBookings()); } catch { setLog([]); } }, []);
  useEffect(() => { void loadLog(); }, [loadLog]);

  const range = useMemo(() => periodRange(period, today), [period, today]);
  const r = useMemo(() => aggregate(log, range, today), [log, range, today]);
  const history = useMemo(
    () => log.filter((x) => x.fecha >= range.from && x.fecha <= range.to)
      .sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 20),
    [log, range],
  );

  // Show the favourite slot as a human time range (from the log), not the internal id like "P1-2".
  const slotLabel = (slot: string) => {
    const rec = log.find((x) => x.slot === slot);
    return rec ? `${rec.start}–${rec.end}` : slot;
  };

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
      <PullToRefresh onRefresh={loadLog}>
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
          {mini(t('stats.favourite'), r.favouriteSlot ? slotLabel(r.favouriteSlot) : t('stats.none'))}
          {mini(t('stats.autoGrabbed'), String(r.autoGrabbed))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {mini(t('stats.upcoming'), String(r.upcoming))}
          {mini(t('stats.hours'), `${r.hours.toFixed(1)} ${t('stats.hUnit')}`)}
        </div>
        <div style={{ fontSize: 10.5, textTransform: 'uppercase', color: '#7e92ad', margin: '12px 0 7px' }}>{t('stats.history')}</div>
        {history.map((x) => {
          const d = ymdToDate(x.fecha);
          const ds = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
          return (
            <div key={x.key} style={{ display: 'flex', gap: 9, padding: '8px 2px', borderBottom: '1px solid #141d2a', fontSize: 12 }}>
              <span style={{ width: 96, color: '#cfe0f5' }}>{ds}</span>
              <span style={{ flex: 1, color: '#8aa0bd' }}>{x.start}–{x.end}</span>
              {(() => {
                const cancelled = x.status === 'cancelled';
                const upcoming = !cancelled && x.fecha >= today;
                const auto = !cancelled && !upcoming && x.origin === 'auto';
                const color = cancelled ? '#ff9b9b' : upcoming ? '#f2c14e' : auto ? '#86b7ff' : '#7ee2a8';
                const label = cancelled ? t('stats.cancelled') : upcoming ? t('stats.upcoming') : auto ? t('mybookings.originAuto') : t('stats.played');
                return <span style={{ color }}>{label}</span>;
              })()}
            </div>
          );
        })}
      </div>
      </PullToRefresh>
    </div>
  );
}
