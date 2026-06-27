import { describe, it, expect } from 'vitest';
import { isMine } from './mine';
import type { Reservation } from './types';
import type { Profile } from './profile';

const profile: Profile = { nombre: 'Dmytro', vivienda: 'P3-7', codigo: 'sol24' };
function res(nombre: string, vivienda: string): Reservation {
  return { id: 1, slot: 'P1-1', fecha: '20260627', nombre, vivienda };
}

describe('isMine', () => {
  it('matches on vivienda + name, case/space-insensitive', () => {
    expect(isMine(res('  dmytro ', 'p3-7'), profile)).toBe(true);
  });
  it('rejects different name (same vivienda)', () => {
    expect(isMine(res('Other', 'P3-7'), profile)).toBe(false);
  });
  it('rejects different vivienda', () => {
    expect(isMine(res('Dmytro', 'P1-1'), profile)).toBe(false);
  });
});
