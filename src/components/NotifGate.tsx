import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentPermState, type PermState } from '../lib/push';
import { enablePush } from '../lib/pushClient';

export function NotifGate({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<PermState>(currentPermState());

  useEffect(() => {
    const recheck = () => setState(currentPermState());
    document.addEventListener('visibilitychange', recheck);
    return () => document.removeEventListener('visibilitychange', recheck);
  }, []);

  async function enable() {
    const ok = await enablePush();
    setState(currentPermState());
    if (ok) onClose();
  }

  const box: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(2,6,12,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 };
  const card: React.CSSProperties = { maxWidth: 320, width: '100%', background: '#101826', border: '1px solid #243246', borderRadius: 18, padding: 18, textAlign: 'center' };
  const btn: React.CSSProperties = { width: '100%', padding: '12px 0', borderRadius: 11, border: 'none', fontWeight: 700, fontSize: 14 };

  return (
    <div style={box} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        {state === 'not-installed' && (<>
          <h3>{t('notif.installTitle')}</h3><p style={{ color: '#9fb3cf', fontSize: 13 }}>{t('notif.installBody')}</p>
          <button style={{ ...btn, background: '#16202e', color: '#cfe0f5' }} onClick={onClose}>{t('common.back')}</button>
        </>)}
        {state === 'prompt' && (<>
          <h3>{t('notif.enableTitle')}</h3><p style={{ color: '#9fb3cf', fontSize: 13 }}>{t('notif.enableBody')}</p>
          <button style={{ ...btn, background: '#1d4ed8', color: '#fff', marginBottom: 8 }} onClick={enable}>{t('notif.enableCta')}</button>
          <button style={{ ...btn, background: '#16202e', color: '#cfe0f5' }} onClick={onClose}>{t('install.later')}</button>
        </>)}
        {state === 'denied' && (<>
          <h3>{t('notif.deniedTitle')}</h3><p style={{ color: '#ffb4b4', fontSize: 13 }}>{t('notif.deniedBody')}</p>
          <button style={{ ...btn, background: '#1d4ed8', color: '#fff' }} onClick={() => setState(currentPermState())}>{t('notif.recheck')}</button>
        </>)}
        {(state === 'granted' || state === 'unsupported') && (<>
          <h3>{state === 'granted' ? t('notif.onTitle') : t('notif.unsupportedTitle')}</h3>
          <button style={{ ...btn, background: '#16202e', color: '#cfe0f5' }} onClick={onClose}>{t('common.back')}</button>
        </>)}
      </div>
    </div>
  );
}
