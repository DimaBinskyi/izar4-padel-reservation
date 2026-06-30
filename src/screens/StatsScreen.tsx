import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listBookings, bookingKey, recordBooking, deleteBookings, pruneOldBookings, type BookingRecord } from '../lib/bookingsDb';
import { aggregate, periodRange, type DateRange } from '../lib/stats';
import { fetchAllReservations, fetchFranjas } from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { applyOverrides } from '../lib/overrides';
import { isMine } from '../lib/mine';
import { dateToYmd, ymdToDate, addDays, addMonths, ymdToISO, isoToYmd } from '../lib/dates';
import { pruneCalendarEvents } from '../lib/calendarEvents';
import { PullToRefresh } from '../components/PullToRefresh';
import type { Profile } from '../lib/profile';

const TTL_MONTHS = 3;   // local history older than this (by game date) is pruned

export function StatsScreen({ profile }: { profile?: Profile | null }) {
  const { t, i18n } = useTranslation();
  const today = dateToYmd(new Date());
  const secret = getDeviceSecret();
  const [log, setLog] = useState<BookingRecord[]>([]);
  // Range picker: default = today ±2 weeks. Quick-fill chips just set this range.
  const [range, setRange] = useState<DateRange>({ from: addDays(today, -14), to: addDays(today, 14) });
  const [preset, setPreset] = useState<string>('2w');
  // Multi-select-to-delete.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Stats reflect ALL of the user's bookings, not only app-created ones, and persist them locally so the
  // history survives even after izar4 drops past games. The izar4 snapshot is the source of truth for what's
  // currently booked (past + upcoming); the local log adds cancelled history + the origin (app/auto). We save
  // ONLY this user's bookings (isMine) — never the whole community's. Reads the fast snapshot (no izar4 spam).
  const loadLog = useCallback(async () => {
    const ttlCutoff = addMonths(today, -TTL_MONTHS);
    try { await pruneOldBookings(ttlCutoff); } catch { /* */ }   // TTL
    try { pruneCalendarEvents(ttlCutoff); } catch { /* */ }       // TTL (calendar flags)
    let local: BookingRecord[] = [];
    try { local = await listBookings(); } catch { /* IndexedDB unavailable */ }
    if (!profile) { setLog(local); return; }
    // A stored record belongs to this user if its owner matches the profile (legacy/auto rows with no
    // owner stored are assumed own — only this device's profile ever writes them).
    const ownRec = (rec: BookingRecord) => !rec.vivienda
      || (rec.vivienda.trim().toUpperCase() === profile.vivienda.trim().toUpperCase()
        && rec.nombre.trim().toLowerCase() === profile.nombre.trim().toLowerCase());
    try {
      const [allRaw, franjas] = await Promise.all([fetchAllReservations(secret, false), fetchFranjas(secret)]);
      const lmap = new Map(local.map((r) => [r.key, r]));
      const fmap = new Map(franjas.map((f) => [f.slot, f]));
      const merged = new Map<string, BookingRecord>();
      for (const rec of local) if (rec.status === 'cancelled' && ownRec(rec)) merged.set(rec.key, rec);
      for (const res of applyOverrides(allRaw.reservas)) {
        if (!isMine(res, profile)) continue;                                          // ONLY this user's bookings
        const key = bookingKey(res.fecha, res.slot);
        const rec = lmap.get(key);
        const f = fmap.get(res.slot);
        merged.set(key, {
          key, reservaId: res.id, fecha: res.fecha, slot: res.slot,
          start: f?.start ?? rec?.start ?? '', end: f?.end ?? rec?.end ?? '',
          nombre: res.nombre || rec?.nombre || '', vivienda: res.vivienda || rec?.vivienda || '',
          codigoUsed: rec?.codigoUsed ?? '', origin: rec?.origin ?? 'izar4',
          status: 'active', createdAt: rec?.createdAt || Date.now(), cancelledAt: rec?.cancelledAt,
        });
      }
      const all = [...merged.values()];
      setLog(all);
      // Persist the pulled-in bookings locally (own only) so they outlive the izar4 snapshot.
      try { await Promise.all(all.filter((r) => r.status === 'active').map((r) => recordBooking(r))); } catch { /* */ }
    } catch { setLog(local); }   // offline / no snapshot → fall back to the local log
  }, [secret, profile, today]);
  useEffect(() => { void loadLog(); }, [loadLog]);

  const r = useMemo(() => aggregate(log, range, today), [log, range, today]);
  const history = useMemo(
    () => log.filter((x) => x.fecha >= range.from && x.fecha <= range.to)
      .sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 50),
    [log, range],
  );

  // Show the favourite slot as a human time range (from the log), not the internal id like "P1-2".
  const slotLabel = (slot: string) => {
    const rec = log.find((x) => x.slot === slot);
    return rec ? `${rec.start}–${rec.end}` : slot;
  };

  // Quick-fill chips for the range (the date inputs still allow any custom span).
  const presets: { key: string; label: string; range: () => DateRange }[] = [
    { key: '2w', label: t('stats.range2w'), range: () => ({ from: addDays(today, -14), to: addDays(today, 14) }) },
    { key: 'week', label: t('stats.week'), range: () => periodRange('week', today) },
    { key: 'month', label: t('stats.month'), range: () => periodRange('month', today) },
    { key: 'all', label: t('stats.all'), range: () => ({ from: addMonths(today, -TTL_MONTHS), to: addDays(today, 30) }) },
  ];

  // Long-press → enter multi-select; tap toggles; the synthesized click after a long-press is ignored.
  // ONLY cancelled bookings are deletable: played/upcoming come from the izar4 snapshot and would just
  // re-appear on the next pull, so they can't be selected at all.
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  function pressStart(key: string, deletable: boolean) {
    if (!deletable || pressTimer.current) return;
    longFired.current = false;
    pressTimer.current = window.setTimeout(() => {
      longFired.current = true; pressTimer.current = null;
      setSelecting(true); setSelected((s) => new Set(s).add(key));
    }, 450);
  }
  function pressEnd() { if (pressTimer.current) { window.clearTimeout(pressTimer.current); pressTimer.current = null; } }
  function rowClick(key: string, deletable: boolean) {
    if (longFired.current) { longFired.current = false; return; }
    if (!selecting || !deletable) return;
    setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); if (n.size === 0) setSelecting(false); return n; });
  }
  function exitSelect() { setSelecting(false); setSelected(new Set()); }
  async function confirmDelete() {
    const keys = [...selected];
    try { await deleteBookings(keys); } catch { /* */ }
    setLog((prev) => prev.filter((x) => !selected.has(x.key)));
    setConfirmOpen(false); exitSelect();
  }

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
  const dateInput: React.CSSProperties = { flex: 1, background: '#0b1320', border: '1px solid #243246', borderRadius: 10, padding: '8px 10px', color: '#eaf2fc', fontSize: 13, colorScheme: 'dark' };

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <PullToRefresh onRefresh={loadLog}>
      <header style={{ textAlign: 'center', padding: '12px 0', fontSize: 17, fontWeight: 700 }}>{t('stats.title')}</header>

      <div style={{ display: 'flex', gap: 6, padding: '0 14px 8px' }}>
        {presets.map((p) => (
          <button key={p.key} onClick={() => { setPreset(p.key); setRange(p.range()); }}
            style={{ fontSize: 12, padding: '6px 10px', borderRadius: 20, border: '1px solid ' + (preset === p.key ? '#1d4ed8' : '#1f2b3c'), background: preset === p.key ? '#1d4ed8' : '#121b28', color: preset === p.key ? '#fff' : '#9fb3cf' }}>
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 14px 12px' }}>
        <input type="date" value={ymdToISO(range.from)} max={ymdToISO(range.to)} style={dateInput}
          onChange={(e) => { setPreset('custom'); setRange((v) => ({ from: isoToYmd(e.target.value), to: v.to })); }} />
        <span style={{ color: '#7e92ad' }}>—</span>
        <input type="date" value={ymdToISO(range.to)} min={ymdToISO(range.from)} style={dateInput}
          onChange={(e) => { setPreset('custom'); setRange((v) => ({ from: v.from, to: isoToYmd(e.target.value) })); }} />
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 7px', minHeight: 24 }}>
          <span style={{ flex: 1, fontSize: 10.5, textTransform: 'uppercase', color: '#7e92ad' }}>{t('stats.history')}</span>
          {selecting ? (
            <>
              <span style={{ fontSize: 11.5, color: '#cfe0f5' }}>{t('stats.selected', { n: selected.size })}</span>
              <button onClick={exitSelect} style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 9, border: 'none', background: '#16202e', color: '#cfe0f5' }}>{t('common.cancel')}</button>
              <button disabled={selected.size === 0} onClick={() => setConfirmOpen(true)}
                style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 9, border: 'none', background: selected.size ? '#3a1620' : '#241016', color: selected.size ? '#ff8a8a' : '#7a4a52', fontWeight: 700 }}>🗑 {t('stats.deleteN', { n: selected.size })}</button>
            </>
          ) : history.length > 0 && <span style={{ fontSize: 10, color: '#5f7390' }}>{t('stats.selectHint')}</span>}
        </div>

        {history.length === 0 && <div style={{ fontSize: 12, color: '#8aa0bd', padding: '4px 2px' }}>{t('stats.none')}</div>}
        {history.map((x) => {
          const d = ymdToDate(x.fecha);
          const ds = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
          const isSel = selected.has(x.key);
          const cancelled = x.status === 'cancelled';
          const upcoming = !cancelled && x.fecha >= today;
          const auto = !cancelled && !upcoming && x.origin === 'auto';
          const color = cancelled ? '#ff9b9b' : upcoming ? '#f2c14e' : auto ? '#86b7ff' : '#7ee2a8';
          const label = cancelled ? t('stats.statusCancelled') : upcoming ? t('stats.upcoming') : auto ? t('mybookings.originAuto') : t('stats.played');
          return (
            <div key={x.key}
              onPointerDown={() => pressStart(x.key, cancelled)} onPointerUp={pressEnd} onPointerLeave={pressEnd} onPointerCancel={pressEnd}
              onClick={() => rowClick(x.key, cancelled)} onContextMenu={(e) => e.preventDefault()}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 2px', borderBottom: '1px solid #141d2a', fontSize: 12, cursor: selecting && cancelled ? 'pointer' : 'default', background: isSel ? '#10203a' : 'transparent', borderRadius: isSel ? 8 : 0, opacity: selecting && !cancelled ? 0.45 : 1, userSelect: 'none', WebkitUserSelect: 'none' }}>
              {selecting && cancelled && (
                <span style={{ width: 18, height: 18, flex: '0 0 auto', borderRadius: 5, border: '1.5px solid ' + (isSel ? '#1d4ed8' : '#3a4a60'), background: isSel ? '#1d4ed8' : 'transparent', color: '#fff', textAlign: 'center', lineHeight: '16px', fontSize: 12 }}>{isSel ? '✓' : ''}</span>
              )}
              <span style={{ width: 96, color: '#cfe0f5' }}>{ds}</span>
              <span style={{ flex: 1, color: '#8aa0bd' }}>{x.start}–{x.end}</span>
              <span style={{ color }}>{label}</span>
            </div>
          );
        })}
      </div>
      </PullToRefresh>

      {confirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 18 }} onClick={() => setConfirmOpen(false)}>
          <div style={{ width: '100%', maxWidth: 360, background: '#101826', borderRadius: 16, padding: '16px 16px 14px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px' }}>{t('stats.deleteTitle')}</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#9fb3cf', lineHeight: 1.45 }}>{t('stats.deleteBody', { n: selected.size })}</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirmOpen(false)} style={{ flex: 1, padding: '11px 0', borderRadius: 11, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }}>{t('common.cancel')}</button>
              <button onClick={() => void confirmDelete()} style={{ flex: 1, padding: '11px 0', borderRadius: 11, border: 'none', background: '#3a1620', color: '#ff8a8a', fontWeight: 700 }}>🗑 {t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
