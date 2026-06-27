import { describe, it, expect } from 'vitest';
import { diffSnapshots, slotStartPassed, weekRange, countWeekKeys, chooseGrab, isWatchExpired } from './logic';

describe('worker logic', () => {
  it('diffSnapshots returns freed and added keys', () => {
    const prev = ['20260628|P1-1', '20260628|P1-2'];
    const curr = ['20260628|P1-2', '20260629|P1-1'];
    expect(diffSnapshots(prev, curr)).toEqual({ freed: ['20260628|P1-1'], added: ['20260629|P1-1'] });
  });

  it('slotStartPassed is true only for today when start <= now', () => {
    const franjas = { 'P1-1': { start: '09:00' }, 'P1-9': { start: '20:30' } };
    const now = new Date(2026, 5, 28, 10, 0); // 28 Jun 10:00
    expect(slotStartPassed('20260628', 'P1-1', franjas, now)).toBe(true);   // 09:00 passed today
    expect(slotStartPassed('20260628', 'P1-9', franjas, now)).toBe(false);  // 20:30 upcoming today
    expect(slotStartPassed('20260629', 'P1-1', franjas, now)).toBe(false);  // future day
    expect(slotStartPassed('20260627', 'P1-1', franjas, now)).toBe(true);   // past day
  });

  it('weekRange + countWeekKeys count a vivienda within the week', () => {
    const wr = weekRange('20260628'); // Sun 28 Jun → Mon22..Sun28
    expect(wr).toEqual({ monday: '20260622', sunday: '20260628' });
    const reservas = [
      { fecha: '20260622', slot: 'P1-1', vivienda: 'P3-7' },
      { fecha: '20260628', slot: 'P1-2', vivienda: 'p3-7' },
      { fecha: '20260629', slot: 'P1-3', vivienda: 'P3-7' },
    ];
    expect(countWeekKeys(reservas, 'P3-7', '20260628')).toBe(2);
  });

  it('chooseGrab returns the first eligible freed slot in the watch range under limits', () => {
    const watch = { fecha: '20260628', franjas: ['P1-7', 'P1-8', 'P1-9'], active: true };
    const freed = ['20260628|P1-8', '20260628|P1-9'];
    const franjas = { 'P1-7': { start: '17:30' }, 'P1-8': { start: '19:00' }, 'P1-9': { start: '20:30' } };
    const now = new Date(2026, 5, 28, 12, 0);
    const got = chooseGrab(watch, freed, { franjas, now, weekCount: 0, dayCount: 0, weeklyLimit: 3, dailyLimit: 1 });
    expect(got).toBe('P1-8'); // first in franja order that is freed + future + within limits
  });

  it('chooseGrab returns null when daily limit already reached', () => {
    const watch = { fecha: '20260628', franjas: ['P1-8'], active: true };
    const got = chooseGrab(watch, ['20260628|P1-8'], { franjas: { 'P1-8': { start: '19:00' } }, now: new Date(2026,5,28,12,0), weekCount: 0, dayCount: 1, weeklyLimit: 3, dailyLimit: 1 });
    expect(got).toBeNull();
  });

  it('chooseGrab skips a freed slot whose start already passed', () => {
    const watch = { fecha: '20260628', franjas: ['P1-1', 'P1-9'], active: true };
    const got = chooseGrab(watch, ['20260628|P1-1', '20260628|P1-9'], { franjas: { 'P1-1': { start: '09:00' }, 'P1-9': { start: '20:30' } }, now: new Date(2026,5,28,10,0), weekCount: 0, dayCount: 0, weeklyLimit: 3, dailyLimit: 1 });
    expect(got).toBe('P1-9'); // P1-1 09:00 passed → skipped
  });

  it('isWatchExpired when all franjas have passed/older than today', () => {
    const franjas = { 'P1-1': { start: '09:00' }, 'P1-2': { start: '10:00' } };
    const now = new Date(2026, 5, 28, 11, 0);
    expect(isWatchExpired({ fecha: '20260628', franjas: ['P1-1', 'P1-2'], active: true }, franjas, now)).toBe(true);  // both passed today
    expect(isWatchExpired({ fecha: '20260628', franjas: ['P1-1', 'P1-9'], active: true }, { ...franjas, 'P1-9': { start: '20:30' } }, now)).toBe(false); // P1-9 still future
    expect(isWatchExpired({ fecha: '20260627', franjas: ['P1-9'], active: true }, { 'P1-9': { start: '20:30' } }, now)).toBe(true); // past day
  });
});
