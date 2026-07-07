import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Franja, Reservation } from '../lib/types';
import { expandRange, loadWatches, addOrMergeWatch, removeWatchById, pruneExpiredWatches, wouldMergeOverwrite, type Watch } from '../lib/watchlist';
import { syncRegistration } from '../lib/pushClient';
import { ymdToDisplay } from '../lib/dates';
import { limitBlockReason } from '../lib/limits';
import { WEEKLY_LIMIT, DAILY_LIMIT } from '../config';

export function WatchSheet({ fecha, franjas, reservations, vivienda, initialSlot = null, initialInfoId = null, onClose }: {
  fecha: string; franjas: Franja[]; reservations: Reservation[]; vivienda: string; initialSlot?: string | null; initialInfoId?: string | null; onClose: () => void;
}) {
  const { t } = useTranslation();
  const ordered = useMemo(() => [...franjas].sort((a, b) => a.order - b.order), [franjas]);
  // Pre-select the tapped slot's time when opened from a slot's 🎯 button (else the full day range).
  const [from, setFrom] = useState(initialSlot ?? ordered[0]?.slot ?? '');
  const [to, setTo] = useState(initialSlot ?? ordered[ordered.length - 1]?.slot ?? '');
  const [watches, setWatches] = useState<Watch[]>(pruneExpiredWatches());   // drop date-passed watches on open
  // Opened from a slot's 👁 button → jump straight to that watch's details (falls back to the list if it's gone).
  const [info, setInfo] = useState<Watch | null>(() => (initialInfoId ? loadWatches().find((w) => w.id === initialInfoId) ?? null : null));
  const [toast, setToast] = useState<{ msg: string; warn: boolean } | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const preview = expandRange(ordered, from, to);
  // A range contiguous with an existing overwrite watch will MERGE into it → force overwrite on and lock it.
  const lockOverwrite = wouldMergeOverwrite(fecha, preview, ordered.map((f) => f.slot));
  const effectiveOverwrite = overwrite || lockOverwrite;

  function showToast(msg: string, warn = false) { setToast({ msg, warn }); window.setTimeout(() => setToast((c) => (c?.msg === msg ? null : c)), 3800); }

  // A watch only makes sense for OCCUPIED slots — a free slot is just bookable now. If the selected
  // range contains ANY free slot, refuse and warn: the user must pick a range of only busy slots.
  function save() {
    if (preview.length === 0) return;
    const occupied = new Set(reservations.filter((r) => r.fecha === fecha).map((r) => r.slot));
    if (preview.some((s) => !occupied.has(s))) { showToast(t('watch.toastHasFree'), true); return; }   // any free → don't create
    const res = addOrMergeWatch(fecha, preview, ordered.map((f) => f.slot), effectiveOverwrite);
    setWatches(loadWatches());
    if (res.status === 'already') { showToast(t('watch.toastAlready'), true); return; }
    void syncRegistration();
    const msg = !res.overwrite ? (res.status === 'merged' ? t('watch.toastMerged', { n: res.count }) : t('watch.toastAdded', { n: res.count }))
      : res.status === 'added' ? t('watch.overwriteAdded', { n: res.count })   // a clean, user-created overwrite watch
      : t('watch.overwriteMergedToast');                                        // merged into / upgraded an overwrite watch
    showToast(msg);
    setOverwrite(false);
  }
  function drop(id?: string) { if (id) removeWatchById(id); setWatches(loadWatches()); setInfo(null); void syncRegistration(); }
  const slotTimes = (slots: string[]) => slots.map((s) => { const f = ordered.find((x) => x.slot === s); return f ? `${f.start}–${f.end}` : s; });
  const watchSpan = (w: Watch) => { const fs = ordered.filter((f) => w.franjas.includes(f.slot)); return fs.length ? `${fs[0].start}–${fs[fs.length - 1].end}` : String(w.franjas.length); };
  // Status of a watch: 'overwrite' (will swap a same-day booking), 'day'/'week' (paused by a limit), or null (armed).
  // For an overwrite watch the daily block is exactly what the swap resolves, so it becomes 'overwrite', not 'day'.
  const watchStatus = (w: Watch): 'overwrite' | 'day' | 'week' | null => {
    const b = limitBlockReason(reservations, vivienda, w.fecha, DAILY_LIMIT, WEEKLY_LIMIT);
    if (w.overwrite) return b === 'day' ? 'overwrite' : b === 'week' ? 'week' : null;
    return b;
  };
  const infoStatus = info ? watchStatus(info) : null;

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 };
  const sheet: React.CSSProperties = { width: '100%', maxWidth: 420, background: '#101826', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '14px 16px 18px' };
  const sel: React.CSSProperties = { flex: 1, background: '#0b1320', border: '1px solid #243246', borderRadius: 10, padding: '9px 11px', color: '#eaf2fc' };
  const chip: React.CSSProperties = { fontSize: 11, padding: '4px 8px', borderRadius: 8, background: '#13261b', color: '#a7e8c1' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px' }}>{t('watch.newTitle')} · {ymdToDisplay(fecha)}</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <select style={sel} value={from} onChange={(e) => setFrom(e.target.value)}>
            {ordered.map((f) => <option key={f.slot} value={f.slot}>{f.start}</option>)}
          </select>
          <select style={sel} value={to} onChange={(e) => setTo(e.target.value)}>
            {ordered.map((f) => <option key={f.slot} value={f.slot}>{f.end}</option>)}
          </select>
        </div>
        <div style={{ background: '#0b1320', border: '1px dashed #2a4d36', borderRadius: 10, padding: '10px 11px', marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#7ee2a8', marginBottom: 6 }}>{t('watch.preview', { n: preview.length })}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {slotTimes(preview).map((tm, i) => <span key={i} style={chip}>{tm}</span>)}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#cfe0f5', marginBottom: lockOverwrite ? 4 : 12, cursor: lockOverwrite ? 'default' : 'pointer' }}>
          <input type="checkbox" checked={effectiveOverwrite} disabled={lockOverwrite} onChange={(e) => setOverwrite(e.target.checked)} style={{ width: 16, height: 16 }} />
          🔁 {t('watch.overwrite')}
        </label>
        {lockOverwrite && <div style={{ fontSize: 11, color: '#7ee2a8', marginBottom: 12 }}>{t('watch.overwriteHintMerge')}</div>}
        <button onClick={save} style={{ width: '100%', padding: '11px 0', borderRadius: 11, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, marginBottom: 14 }}>＋ {t('watch.add')}</button>

        <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#7e92ad', marginBottom: 8 }}>{t('watch.active')}</div>
        {watches.length === 0 && <div style={{ fontSize: 12, color: '#8aa0bd' }}>{t('watch.none')}</div>}
        {watches.map((w) => {
          const st = watchStatus(w);
          const glyph = st === 'overwrite' ? '🔁' : (st === 'day' || st === 'week') ? '⏸' : w.overwrite ? '🔁' : w.active ? '🟢' : '⚪';
          return (
          <div key={w.id ?? w.fecha} onClick={() => setInfo(w)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #141d2a', cursor: 'pointer' }}>
            <div style={{ flex: 1, fontSize: 12.5 }}>
              {ymdToDisplay(w.fecha)} · {watchSpan(w)} {glyph}
              {st === 'overwrite' && <span style={{ marginLeft: 6, fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: '#0e2018', color: '#7ee2a8' }}>🔁 {t('watch.overwriteBadge')}</span>}
              {st === 'day' && <span style={{ marginLeft: 6, fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: '#241a00', color: '#f2c14e' }}>⏸ {t('watch.dayLimit')}</span>}
              {st === 'week' && <span style={{ marginLeft: 6, fontSize: 10.5, padding: '2px 7px', borderRadius: 20, background: '#241a00', color: '#f2c14e' }}>⏳ {t('watch.limitWaiting')}</span>}
            </div>
            <span style={{ color: '#5a6b82', fontSize: 15 }}>›</span>
          </div>
          );
        })}
      </div>

      {info && (
        <div style={{ ...overlay, zIndex: 60 }} onClick={(e) => { e.stopPropagation(); setInfo(null); }}>
          <div style={sheet} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px' }}>{t('watch.title')} · {ymdToDisplay(info.fecha)} {infoStatus === 'overwrite' ? '🔁' : (infoStatus === 'day' || infoStatus === 'week') ? '⏸' : info.overwrite ? '🔁' : info.active ? '🟢' : '⚪'}</h3>
            {(infoStatus === 'overwrite' || (infoStatus === null && info.overwrite)) && <div style={{ fontSize: 12, color: '#7ee2a8', marginBottom: 10 }}>🔁 {t('watch.overwriteInfo')}</div>}
            {infoStatus === 'day' && <div style={{ fontSize: 12, color: '#f2c14e', marginBottom: 10 }}>⏸ {t('watch.dayLimitInfo')}</div>}
            {infoStatus === 'week' && <div style={{ fontSize: 12, color: '#f2c14e', marginBottom: 10 }}>⏳ {t('watch.limitWaiting')}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {slotTimes(info.franjas).map((tm, i) => <span key={i} style={chip}>{tm}</span>)}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setInfo(null)} style={{ flex: 1, padding: '11px 0', borderRadius: 11, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }}>{t('common.back')}</button>
              <button onClick={() => drop(info.id)} style={{ flex: 1, padding: '11px 0', borderRadius: 11, border: 'none', background: '#3a1620', color: '#ff8a8a', fontWeight: 700 }}>🗑 {t('watch.remove')}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', left: 0, right: 0, top: 'calc(env(safe-area-inset-top) + 12px)', display: 'flex', justifyContent: 'center', zIndex: 70, pointerEvents: 'none' }}>
          <div style={{ maxWidth: 360, margin: '0 14px', borderRadius: 12, padding: '10px 14px', fontSize: 12.5, boxShadow: '0 6px 20px rgba(0,0,0,.4)',
            ...(toast.warn ? { background: '#241a00', border: '1px solid #4a3a12', color: '#f2c14e' } : { background: '#0e2018', border: '1px solid #234e34', color: '#a7e8c1' }) }}>
            {toast.warn ? '⚠️ ' : ''}{toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}
