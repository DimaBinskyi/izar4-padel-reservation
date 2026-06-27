import { describe, it, expect, beforeEach } from 'vitest';
import { loadProfile, saveProfile, isProfileComplete, type Profile } from './profile';

beforeEach(() => localStorage.clear());

describe('profile', () => {
  it('returns null when nothing saved', () => {
    expect(loadProfile()).toBeNull();
  });

  it('saves and loads a profile', () => {
    const p: Profile = { nombre: 'Dmytro', vivienda: 'P3-7', codigo: 'sol24' };
    saveProfile(p);
    expect(loadProfile()).toEqual(p);
  });

  it('isProfileComplete requires all three non-empty fields', () => {
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete({ nombre: 'A', vivienda: '', codigo: 'x' })).toBe(false);
    expect(isProfileComplete({ nombre: ' ', vivienda: 'P1-1', codigo: 'x' })).toBe(false);
    expect(isProfileComplete({ nombre: 'A', vivienda: 'P1-1', codigo: 'x' })).toBe(true);
  });
});
