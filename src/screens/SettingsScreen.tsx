import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProfileModal } from '../components/ProfileModal';
import { setLanguage } from '../i18n';
import { APP_VERSION } from '../config';
import type { Profile } from '../lib/profile';

const LANGS: { code: 'uk' | 'en' | 'ru' | 'es'; label: string }[] = [
  { code: 'uk', label: 'Українська' }, { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' }, { code: 'es', label: 'Español' },
];

export function SettingsScreen({ profile, onProfileSaved }: { profile: Profile; onProfileSaved: (p: Profile) => void }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);

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
    </div>
  );
}
