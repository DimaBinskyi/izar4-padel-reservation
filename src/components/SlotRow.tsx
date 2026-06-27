import { useTranslation } from 'react-i18next';
import type { SlotView } from '../lib/types';

const BADGE: Record<string, { bg: string; fg: string }> = {
  libre: { bg: '#10261a', fg: '#7ee2a8' },
  ocupado: { bg: '#2a1414', fg: '#ff9b9b' },
  bloqueado: { bg: '#1a1a1a', fg: '#7a7a7a' },
  pasado: { bg: '#1a1a1a', fg: '#7a7a7a' },
  pronto: { bg: '#241a00', fg: '#f2c14e' },
  mine: { bg: '#101a2b', fg: '#86b7ff' },
};

interface Props {
  slot: SlotView;
  mine: boolean;          // this occupied slot belongs to the user
  canBook: boolean;       // false when the date is beyond the booking horizon (view-only)
  onBook: () => void;     // for free slots
  onCancel: () => void;   // for own slots
}

export function SlotRow({ slot, mine, canBook, onBook, onCancel }: Props) {
  const { t } = useTranslation();
  const badgeKey = mine && slot.status === 'ocupado' ? 'mine' : slot.status;
  const c = BADGE[badgeKey];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 8px', borderBottom: '1px solid #141d2a' }}>
      <div style={{ width: 96, fontSize: 12.5, fontWeight: 600 }}>{slot.franja.start}–{slot.franja.end}</div>
      <div style={{ width: 78 }}>
        <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.fg }}>
          {t(`status.${badgeKey}`)}
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
      <div style={{ width: 34 }}>
        {slot.status === 'libre' && canBook && (
          <button onClick={onBook} aria-label="book"
            style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: '#1d4ed8', color: '#fff', fontSize: 17, fontWeight: 700 }}>+</button>
        )}
        {slot.status === 'ocupado' && mine && (
          <button onClick={onCancel} aria-label="cancel"
            style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: '#3a1620', color: '#ff8a8a', fontSize: 17, fontWeight: 700 }}>×</button>
        )}
      </div>
    </div>
  );
}
