import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Franja } from '../lib/types';
import { expandRange, loadWatches, addWatch, removeWatch, type Watch } from '../lib/watchlist';
import { syncRegistration } from '../lib/pushClient';

export function WatchSheet({ fecha, franjas, onClose }: { fecha: string; franjas: Franja[]; onClose: () => void }) {
  const { t } = useTranslation();
  const ordered = useMemo(() => [...franjas].sort((a, b) => a.order - b.order), [franjas]);
  const [from, setFrom] = useState(ordered[0]?.slot ?? '');
  const [to, setTo] = useState(ordered[ordered.length - 1]?.slot ?? '');
  const [watches, setWatches] = useState<Watch[]>(loadWatches());
  const preview = expandRange(ordered, from, to);

  function save() {
    addWatch({ fecha, franjas: preview, active: true });
    setWatches(loadWatches());
    void syncRegistration();
  }
  function drop(f: string) { removeWatch(f); setWatches(loadWatches()); void syncRegistration(); }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 };
  const sheet: React.CSSProperties = { width: '100%', maxWidth: 420, background: '#101826', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '14px 16px 18px' };
  const sel: React.CSSProperties = { flex: 1, background: '#0b1320', border: '1px solid #243246', borderRadius: 10, padding: '9px 11px', color: '#eaf2fc' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px' }}>{t('watch.newTitle')} · {fecha}</h3>
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
            {preview.map((s) => {
              const f = ordered.find((x) => x.slot === s)!;
              return <span key={s} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 8, background: '#13261b', color: '#a7e8c1' }}>{f.start}–{f.end}</span>;
            })}
          </div>
        </div>
        <button onClick={save} style={{ width: '100%', padding: '11px 0', borderRadius: 11, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, marginBottom: 14 }}>＋ {t('watch.add')}</button>

        <div style={{ fontSize: 11, textTransform: 'uppercase', color: '#7e92ad', marginBottom: 8 }}>{t('watch.active')}</div>
        {watches.length === 0 && <div style={{ fontSize: 12, color: '#8aa0bd' }}>{t('watch.none')}</div>}
        {watches.map((w) => (
          <div key={w.fecha} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #141d2a' }}>
            <div style={{ flex: 1, fontSize: 12.5 }}>{w.fecha} · {w.franjas.length} · {w.active ? '🟢' : '⚪'}</div>
            <button onClick={() => drop(w.fecha)} style={{ border: 'none', background: '#16202e', color: '#8aa0bd', borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>🗑</button>
          </div>
        ))}
      </div>
    </div>
  );
}
