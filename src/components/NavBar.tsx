import { useTranslation } from 'react-i18next';

export type Tab = 'slots' | 'mybookings' | 'stats' | 'settings';
const ICONS: Record<Tab, string> = { slots: '📅', mybookings: '🗂', stats: '📊', settings: '⚙️' };

export function NavBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const { t } = useTranslation();
  const tabs: Tab[] = ['slots', 'mybookings', 'stats', 'settings'];
  return (
    <nav style={{ position: 'sticky', bottom: 0, display: 'flex', borderTop: '1px solid #1c2533', background: '#0b0f17', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {tabs.map((x) => (
        <button key={x} onClick={() => onChange(x)}
          style={{ flex: 1, textAlign: 'center', padding: '9px 0 11px', border: 'none', background: 'transparent', fontSize: 10.5, color: tab === x ? '#86b7ff' : '#7e92ad' }}>
          <span style={{ fontSize: 16, display: 'block', marginBottom: 2 }}>{ICONS[x]}</span>
          {t(`nav.${x}`)}
        </button>
      ))}
    </nav>
  );
}
