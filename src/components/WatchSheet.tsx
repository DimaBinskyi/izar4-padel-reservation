import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Franja } from '../lib/types';
import { expandRange, loadWatches, addWatch, removeWatch, pruneExpiredWatches, type Watch } from '../lib/watchlist';
import { syncRegistration } from '../lib/pushClient';
import { ymdToDisplay } from '../lib/dates';

export function WatchSheet({ fecha, franjas, initialSlot = null, onClose }: { fecha: string; franjas: Franja[]; initialSlot?: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const ordered = useMemo(() => [...franjas].sort((a, b) => a.order - b.order), [franjas]);
  // Pre-select the tapped slot's time when opened from a slot's 🎯 button (else the full day range).
  const [from, setFrom] = useState(initialSlot ?? ordered[0]?.slot ?? '');
  const [to, setTo] = useState(initialSlot ?? ordered[ordered.length - 1]?.slot ?? '');
  const [watches, setWatches] = useState<Watch[]>(pruneExpiredWatches());   // drop date-passed watches on open
  const [info, setInfo] = useState<Watch | null>(null);   // read-only details of a tapped active watch
  const preview = expandRange(ordered, from, to);

  function save() {
    addWatch({ fecha, franjas: preview, active: true });
    setWatches(loadWatches());
    void syncRegistration();
  }
  function drop(f: string) { removeWatch(f); setWatches(loadWatches()); setInfo(null); void syncRegistration(); }
  const slotTimes = (slots: string[]) => slots.map((s) => { const f = ordered.find((x) => x.slot === s); return f ? `${f.start}–${f.end}` : s; });

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
        <button onClick={save} style={{ width: '100%', padding: '11px 0', borderRadius: 11, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, marginBottom: 14 }}>＋ {t('watch.add')}</button>

        <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#7e92ad', marginBottom: 8 }}>{t('watch.active')}</div>
        {watches.length === 0 && <div style={{ fontSize: 12, color: '#8aa0bd' }}>{t('watch.none')}</div>}
        {watches.map((w) => (
          <div key={w.fecha} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #141d2a' }}>
            <div style={{ flex: 1, fontSize: 12.5, cursor: 'pointer' }} onClick={() => setInfo(w)}>{ymdToDisplay(w.fecha)} · {w.franjas.length} · {w.active ? '🟢' : '⚪'}</div>
            <button onClick={() => drop(w.fecha)} style={{ border: 'none', background: '#16202e', color: '#8aa0bd', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>🗑</button>
          </div>
        ))}
      </div>

      {info && (
        <div style={{ ...overlay, zIndex: 60 }} onClick={(e) => { e.stopPropagation(); setInfo(null); }}>
          <div style={sheet} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px' }}>{t('watch.title')} · {ymdToDisplay(info.fecha)} {info.active ? '🟢' : '⚪'}</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {slotTimes(info.franjas).map((tm, i) => <span key={i} style={chip}>{tm}</span>)}
            </div>
            <button onClick={() => setInfo(null)} style={{ width: '100%', padding: '11px 0', borderRadius: 11, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }}>{t('common.back')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
