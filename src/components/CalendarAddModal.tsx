import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// Shown before handing the .ics to the OS, because the OS always opens its own "choose a calendar
// + Add" dialog that we can't bypass from a PWA (and a transient toast is hidden behind that sheet).
// "Continue" triggers the add; the checkbox lets the user skip this explainer next time.
interface Props {
  onContinue: (dontShowAgain: boolean) => void;
  onClose: () => void;
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 55 };
const sheet: React.CSSProperties = { width: '100%', maxWidth: 420, background: '#101826', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: '1px solid #243246', padding: '16px 16px 18px' };

export function CalendarAddModal({ onContinue, onClose }: Props) {
  const { t } = useTranslation();
  const [dontShow, setDontShow] = useState(false);
  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>📅 {t('calendar.hintTitle')}</h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.45, color: '#c4d4e8' }}>{t('calendar.hintBody')}</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: '#cfe0f5', marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} style={{ width: 17, height: 17 }} />
          {t('calendar.hintDontShow')}
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }} onClick={onClose}>{t('common.back')}</button>
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700 }} onClick={() => onContinue(dontShow)}>{t('calendar.hintContinue')}</button>
        </div>
      </div>
    </div>
  );
}
