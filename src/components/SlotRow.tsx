import { useTranslation } from 'react-i18next';
import type { SlotView } from '../lib/types';

const BADGE: Record<string, { bg: string; fg: string }> = {
  libre: { bg: '#10261a', fg: '#7ee2a8' },
  ocupado: { bg: '#2a1414', fg: '#ff9b9b' },
  bloqueado: { bg: '#1a1a1a', fg: '#7a7a7a' },
  pasado: { bg: '#1a1a1a', fg: '#7a7a7a' },
  pronto: { bg: '#241a00', fg: '#f2c14e' },
};

export function SlotRow({ slot }: { slot: SlotView }) {
  const { t } = useTranslation();
  const c = BADGE[slot.status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 8px', borderBottom: '1px solid #141d2a' }}>
      <div style={{ width: 96, fontSize: 12.5, fontWeight: 600 }}>
        {slot.franja.start}–{slot.franja.end}
      </div>
      <div style={{ width: 78 }}>
        <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.fg }}>
          {t(`status.${slot.status}`)}
        </span>
      </div>
      <div style={{ flex: 1, fontSize: 12 }}>
        {slot.reservation && (
          <>
            <div style={{ color: '#dce8f7' }}>{slot.reservation.nombre}</div>
            <div style={{ color: '#8aa0bd', fontSize: 10.5 }}>{slot.reservation.vivienda}</div>
          </>
        )}
      </div>
    </div>
  );
}
