import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlotView } from '../lib/types';
import type { Profile } from '../lib/profile';
import { ymdToDate } from '../lib/dates';
import { getBookingCode } from '../lib/bookingsDb';
import { fetchReservationCode } from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { planCancel, type CancelPlan } from '../lib/cancelPolicy';

interface Props {
  slot: SlotView;        // must have slot.reservation
  fecha: string;
  profile: Profile;
  onConfirm: (codigo: string) => Promise<boolean>;  // returns false on wrong code
  onClose: () => void;
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 };
const sheet: React.CSSProperties = { width: '100%', maxWidth: 420, background: '#101826', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: '1px solid #243246', padding: '14px 16px 18px' };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 };

export function CancelModal({ slot, fecha, profile, onConfirm, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [plan, setPlan] = useState<CancelPlan | null>(null);
  const [typed, setTyped] = useState(profile.codigo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = ymdToDate(fecha);
  const dateStr = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);

  useEffect(() => {
    (async () => {
      const remembered = await getBookingCode(fecha, slot.franja.slot);
      let apiCode = '';
      if (!remembered) apiCode = await fetchReservationCode(getDeviceSecret(), slot.reservation!.id).catch(() => '');
      setPlan(planCancel({ rememberedCode: remembered, apiCode, profileCode: profile.codigo }));
    })();
  }, [fecha, slot, profile.codigo]);

  async function go() {
    if (!plan) return;
    const codigo = plan.mode === 'ask' ? typed.trim() : plan.codigo;
    if (!codigo) { setError(t('cancel.wrongCode')); return; }
    setBusy(true); setError(null);
    try {
      const ok = await onConfirm(codigo);
      if (!ok) { setError(t('cancel.wrongCode')); setBusy(false); }
    } catch { setError(t('cancel.error')); setBusy(false); }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>{t('cancel.title')}</h3>
        <div style={{ fontSize: 12, color: '#ffb4b4', background: '#241316', border: '1px solid #4a2129', borderRadius: 9, padding: '8px 10px', marginBottom: 12 }}>{t('cancel.warn')}</div>
        <div style={{ background: '#0b1320', border: '1px solid #1e2a3c', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.date')}</span><b>{dateStr}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('booking.slot')}</span><b>{slot.franja.start} – {slot.franja.end}</b></div>
          <div style={row}><span style={{ color: '#8aa0bd' }}>{t('cancel.yours')}</span><b>{profile.nombre} · {profile.vivienda}</b></div>
        </div>
        {plan && plan.mode !== 'ask' && (
          <div style={{ fontSize: 12, color: '#7ee2a8', background: '#0e2018', border: '1px solid #234e34', borderRadius: 9, padding: '8px 10px', marginBottom: 12 }}>{t('cancel.codeRemembered')}</div>
        )}
        {plan && plan.mode === 'ask' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11.5, color: '#8aa0bd', marginBottom: 6 }}>{t('cancel.askCode')}</div>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('cancel.enterCode')}
              style={{ width: '100%', background: '#0a1018', border: '1px solid #243246', borderRadius: 9, padding: '9px 11px', fontSize: 13, color: '#eaf2fc', fontFamily: 'monospace' }} />
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: '#ff9b9b', marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }} onClick={onClose} disabled={busy}>{t('common.back')}</button>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#b3261e', color: '#fff', fontWeight: 700, opacity: busy || !plan ? 0.6 : 1 }} onClick={go} disabled={busy || !plan}>{t('cancel.doCancel')}</button>
        </div>
      </div>
    </div>
  );
}
