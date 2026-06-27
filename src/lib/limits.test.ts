import { describe, it, expect } from 'vitest';
import { weekRange, countWeek, countDay, weeklyRemaining } from './limits';
import type { Reservation } from './types';

function res(fecha: string, vivienda: string, slot = 'P1-1'): Reservation {
  return { id: Math.random(), slot, fecha, nombre: 'x', vivienda };
}

describe('limits', () => {
  it('weekRange returns Mon..Sun containing the date', () => {
    // 20260627 is Saturday → week Mon 22 .. Sun 28 June 2026
    expect(weekRange('20260627')).toEqual({ monday: '20260622', sunday: '20260628' });
  });

  it('countWeek counts a vivienda within the date\'s week (case-insensitive)', () => {
    const all = [res('20260622', 'P3-7'), res('20260628', 'p3-7'), res('20260629', 'P3-7'), res('20260623', 'P1-1')];
    expect(countWeek(all, 'P3-7', '20260627')).toBe(2); // 22 and 28 in-week; 29 is next week
  });

  it('countDay counts a vivienda on an exact date', () => {
    const all = [res('20260627', 'P3-7', 'P1-1'), res('20260627', 'P3-7', 'P1-2'), res('20260627', 'P1-1')];
    expect(countDay(all, 'P3-7', '20260627')).toBe(2);
  });

  it('weeklyRemaining is limit minus week count, floored at 0', () => {
    const all = [res('20260622', 'P3-7'), res('20260623', 'P3-7'), res('20260624', 'P3-7')];
    expect(weeklyRemaining(all, 'P3-7', '20260627', 3)).toBe(0);
    expect(weeklyRemaining([], 'P3-7', '20260627', 3)).toBe(3);
  });
});
