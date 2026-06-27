import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }>; }

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}
function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

const DISMISS_KEY = 'padel_install_dismissed';

export function InstallBanner() {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;
    const onBIP = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); setShow(true); };
    window.addEventListener('beforeinstallprompt', onBIP);
    if (isIOS()) setShow(true); // iOS: no event, show instructions
    return () => window.removeEventListener('beforeinstallprompt', onBIP);
  }, []);

  if (!show) return null;

  function dismiss() { localStorage.setItem(DISMISS_KEY, '1'); setShow(false); }
  async function install() {
    if (deferred) { await deferred.prompt(); setShow(false); }
  }

  return (
    <div style={{ margin: '8px 14px', background: '#101a2b', border: '1px solid #21304a', borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, fontSize: 12.5, color: '#cfe0f5' }}>
        {t('install.banner')}
        {isIOS() && !deferred && <div style={{ fontSize: 11, color: '#86b7ff', marginTop: 4 }}>{t('install.ios')}</div>}
      </div>
      {deferred && (
        <button onClick={install} style={{ border: 'none', borderRadius: 9, padding: '8px 12px', background: '#1d4ed8', color: '#fff', fontWeight: 700, fontSize: 12.5 }}>{t('install.cta')}</button>
      )}
      <button onClick={dismiss} aria-label="dismiss" style={{ border: 'none', borderRadius: 9, padding: '8px 10px', background: '#16202e', color: '#8aa0bd', fontSize: 12.5 }}>{t('install.later')}</button>
    </div>
  );
}
