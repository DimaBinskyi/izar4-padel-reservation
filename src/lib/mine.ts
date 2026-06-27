import type { Reservation } from './types';
import type { Profile } from './profile';

const norm = (s: string) => s.trim().toLowerCase();

export function isMine(r: Reservation, profile: Profile): boolean {
  return (
    r.vivienda.trim().toUpperCase() === profile.vivienda.trim().toUpperCase() &&
    norm(r.nombre) === norm(profile.nombre)
  );
}
