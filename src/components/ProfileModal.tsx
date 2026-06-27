import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchInmuebles } from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import type { Profile } from '../lib/profile';

interface Props {
  initial: Profile | null;
  mode: 'fill' | 'edit';
  onSave: (p: Profile) => void;
  onClose?: () => void;   // only in edit mode (fill mode is mandatory)
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(2,6,12,.66)', display: 'flex',
  alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50,
};
const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 420, marginTop: 48, background: '#101826',
  border: '1px solid #243246', borderRadius: 18, padding: 16,
};
const inp: React.CSSProperties = {
  width: '100%', background: '#0b1320', border: '1px solid #243246', borderRadius: 10,
  padding: '10px 11px', fontSize: 13, color: '#eaf2fc',
};
const label: React.CSSProperties = { display: 'block', fontSize: 11, textTransform: 'uppercase', color: '#7e92ad', margin: '4px 0 5px' };

export function ProfileModal({ initial, mode, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [vivienda, setVivienda] = useState(initial?.vivienda ?? '');
  const [codigo, setCodigo] = useState(initial?.codigo ?? '');
  const [viviendas, setViviendas] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    fetchInmuebles(getDeviceSecret()).then(setViviendas).catch(() => setViviendas([]));
  }, []);

  const matches = vivienda.trim()
    ? viviendas.filter((v) => v.toLowerCase().includes(vivienda.trim().toLowerCase())).slice(0, 8)
    : [];
  const exact = viviendas.some((v) => v.toUpperCase() === vivienda.trim().toUpperCase());
  const valid = nombre.trim() !== '' && exact && codigo.trim() !== '';

  function submit() {
    setTouched(true);
    if (!valid) return;
    onSave({ nombre: nombre.trim(), vivienda: vivienda.trim().toUpperCase(), codigo: codigo.trim() });
  }

  return (
    <div style={overlay} onClick={() => mode === 'edit' && onClose?.()}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>
          {mode === 'fill' ? t('profile.fillTitle') : t('profile.editTitle')}
        </h3>
        {mode === 'fill' && (
          <p style={{ margin: '0 0 14px', fontSize: 11.5, color: '#8aa0bd' }}>{t('profile.fillSubtitle')}</p>
        )}

        <div style={{ marginBottom: 12 }}>
          <label style={label}>{t('profile.name')}</label>
          <input style={inp} value={nombre} placeholder={t('profile.namePlaceholder')}
            onChange={(e) => setNombre(e.target.value)} />
        </div>

        <div style={{ marginBottom: 12, position: 'relative' }}>
          <label style={label}>{t('profile.apartment')}</label>
          <input style={inp} value={vivienda} placeholder={t('profile.apartmentSearch')}
            onChange={(e) => setVivienda(e.target.value)} autoCapitalize="characters" />
          {matches.length > 0 && !exact && (
            <div style={{ background: '#0b1320', border: '1px solid #243246', borderTop: 'none', borderRadius: '0 0 10px 10px' }}>
              {matches.map((v) => (
                <div key={v} style={{ padding: '8px 11px', fontSize: 12.5, color: '#cfe0f5', cursor: 'pointer' }}
                  onClick={() => setVivienda(v)}>{v}</div>
              ))}
            </div>
          )}
          {touched && !exact && (
            <div style={{ fontSize: 11, color: '#ff9b9b', marginTop: 5 }}>{t('profile.pickFromList')}</div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>{t('profile.cancelCode')}</label>
          <input style={inp} value={codigo} placeholder={t('profile.codePlaceholder')}
            onChange={(e) => setCodigo(e.target.value)} />
          <div style={{ fontSize: 11, color: '#86b7ff', marginTop: 5 }}>{t('profile.codeHint')}</div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          {mode === 'edit' && (
            <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#16202e', color: '#cfe0f5', fontWeight: 700 }}
              onClick={() => onClose?.()}>{t('common.cancel')}</button>
          )}
          <button style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: 'none', background: '#1d4ed8', color: '#fff', fontWeight: 700, opacity: valid ? 1 : 0.6 }}
            onClick={submit}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}
