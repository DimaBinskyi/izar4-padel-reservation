import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileModal } from '../components/ProfileModal';
import { setLanguage } from '../i18n';
import { APP_VERSION } from '../config';
import type { Profile } from '../lib/profile';
import { loadPrefs, savePrefs, type NotifPrefs, type NotifType } from '../lib/notifPrefs';
import { syncRegistration } from '../lib/pushClient';
import { NotifGate } from '../components/NotifGate';
import { currentPermState } from '../lib/push';

const LANGS: { code: 'uk' | 'en' | 'ru' | 'es'; label: string }[] = [
  { code: 'uk', label: 'Українська' }, { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' }, { code: 'es', label: 'Español' },
];

export function SettingsScreen({ profile, onProfileSaved }: { profile: Profile; onProfileSaved: (p: Profile) => void }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs());
  const [gateOpen, setGateOpen] = useState(false);
  function update(p: NotifPrefs) { setPrefs(p); savePrefs(p); void syncRegistration(); }
  const toggle = (on: boolean) => (
    <span style={{ width: 38, height: 22, borderRadius: 20, background: on ? '#1d4ed8' : '#33415a', position: 'relative', flex: '0 0 auto' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff' }} />
    </span>
  );

  const group: React.CSSProperties = { background: '#101826', border: '1px solid #1f2b3c', borderRadius: 14, padding: '6px 12px', margin: '0 14px 10px' };
  const item: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #141d2a', fontSize: 13 };
  const label: React.CSSProperties = { fontSize: 10.5, textTransform: 'uppercase', color: '#7e92ad', margin: '8px 14px 7px' };

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <header style={{ textAlign: 'center', padding: '12px 0', fontSize: 17, fontWeight: 700 }}>{t('settings.title')}</header>

      <div style={label}>{t('settings.profile')}</div>
      <div style={group}>
        <div style={item}><span>{t('profile.name')}</span><b>{profile.nombre}</b></div>
        <div style={item}><span>{t('profile.apartment')}</span><b>{profile.vivienda}</b></div>
        <div style={{ ...item, borderBottom: 'none' }}>
          <span>{t('profile.cancelCode')}</span>
          <button onClick={() => setEditing(true)} style={{ border: 'none', background: 'transparent', color: '#86b7ff', fontSize: 12.5 }}>{profile.codigo} · {t('settings.editProfile')} ›</button>
        </div>
      </div>

      <div style={label}>{t('settings.language')}</div>
      <div style={group}>
        {LANGS.map((l, i) => (
          <div key={l.code} style={{ ...item, borderBottom: i === LANGS.length - 1 ? 'none' : item.borderBottom }}>
            <span>{l.label}</span>
            <input type="radio" name="lang" checked={i18n.language === l.code} onChange={() => setLanguage(l.code)} />
          </div>
        ))}
      </div>

      <div style={label}>{t('notif.section')}</div>
      <div style={group}>
        <div style={item} onClick={() => { if (currentPermState() !== 'granted') setGateOpen(true); else update({ ...prefs, master: !prefs.master }); }}>
          <span>{t('notif.master')}</span>{toggle(prefs.master && currentPermState() === 'granted')}
        </div>
        {(['freed','grabbed','limitOff','watchExpired','myCancelled'] as NotifType[]).map((ty) => (
          <div key={ty} style={item} onClick={() => update({ ...prefs, types: { ...prefs.types, [ty]: !prefs.types[ty] } })}>
            <span>{t(`notif.${ty}`)}</span>{toggle(prefs.types[ty])}
          </div>
        ))}
        <div style={{ ...item, borderBottom: 'none' }} onClick={() => update({ ...prefs, suppressSelf: !prefs.suppressSelf })}>
          <span>{t('notif.suppressSelf')}</span>{toggle(prefs.suppressSelf)}
        </div>
      </div>

      <div style={label}>{t('notif.quiet')}</div>
      <div style={group}>
        <div style={item} onClick={() => update({ ...prefs, quiet: { ...prefs.quiet, enabled: !prefs.quiet.enabled } })}>
          <span>{t('notif.quiet')}</span>{toggle(prefs.quiet.enabled)}
        </div>
        {prefs.quiet.enabled && (
          <div style={{ ...item, borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#7e92ad' }}>{t('notif.nightAllowed')}</div>
            {(['grabbed','freed','myCancelled'] as NotifType[]).map((ty) => (
              <div key={ty} style={{ display: 'flex', justifyContent: 'space-between' }} onClick={() => update({ ...prefs, quiet: { ...prefs.quiet, nightAllowed: { ...prefs.quiet.nightAllowed, [ty]: !prefs.quiet.nightAllowed[ty] } } })}>
                <span style={{ fontSize: 12.5, color: '#bcd3f3' }}>{t(`notif.${ty}`)}</span>{toggle(prefs.quiet.nightAllowed[ty])}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={label}>{t('settings.limits')}</div>
      <div style={group}>
        <div style={{ ...item, borderBottom: 'none' }}><span>{t('settings.limits')}</span><b>{t('settings.limitsValue')}</b></div>
      </div>

      <div style={label}>{t('settings.version')}</div>
      <div style={group}>
        <div style={item}>
          <span>{t('settings.install')}</span>
          <button onClick={() => { localStorage.removeItem('padel_install_dismissed'); localStorage.removeItem('padel_visits'); alert(t('install.banner')); }}
            style={{ border: 'none', background: 'transparent', color: '#86b7ff', fontSize: 12.5 }}>{t('settings.install')} ›</button>
        </div>
        <div style={{ ...item, borderBottom: 'none' }}><span>{t('settings.version')}</span><b>{APP_VERSION}</b></div>
      </div>

      {editing && (
        <ProfileModal initial={profile} mode="edit"
          onSave={(p) => { onProfileSaved(p); setEditing(false); }} onClose={() => setEditing(false)} />
      )}
      {gateOpen && <NotifGate onClose={() => { setGateOpen(false); setPrefs(loadPrefs()); }} />}
    </div>
  );
}
