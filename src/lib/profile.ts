export interface Profile {
  nombre: string;
  vivienda: string;
  codigo: string;
}

const KEY = 'padel_profile';

export function loadProfile(): Profile | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Profile;
    return { nombre: p.nombre ?? '', vivienda: p.vivienda ?? '', codigo: p.codigo ?? '' };
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function isProfileComplete(p: Profile | null): boolean {
  return !!p && p.nombre.trim() !== '' && p.vivienda.trim() !== '' && p.codigo.trim() !== '';
}
