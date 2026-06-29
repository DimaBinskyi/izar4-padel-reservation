import { describe, it, expect } from 'vitest';
import { ymdToDate, dateToYmd, normalizeYmd, weekdayCode, addDays, addMonths, ymdToISO, isoToYmd, isPastYmd, isTodayYmd } from './dates';

describe('dates', () => {
  it('ymdToDate / dateToYmd round-trip', () => {
    const d = ymdToDate('20260627');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June (0-based)
    expect(d.getDate()).toBe(27);
    expect(dateToYmd(d)).toBe('20260627');
  });

  it('normalizeYmd accepts Ymd and dd/mm/yyyy', () => {
    expect(normalizeYmd('20260627')).toBe('20260627');
    expect(normalizeYmd('27/06/2026')).toBe('20260627');
  });

  it('weekdayCode maps to D L M X J V S (Sun=0)', () => {
    expect(weekdayCode('20260628')).toBe('D'); // 28 Jun 2026 is Sunday
    expect(weekdayCode('20260629')).toBe('L'); // Monday
    expect(weekdayCode('20260627')).toBe('S'); // Saturday
  });

  it('addDays returns Ymd offset', () => {
    expect(addDays('20260627', 21)).toBe('20260718');
  });

  it('addMonths shifts by calendar months', () => {
    expect(addMonths('20260627', -3)).toBe('20260327');
    expect(addMonths('20260115', 1)).toBe('20260215');
  });

  it('ymdToISO / isoToYmd round-trip', () => {
    expect(ymdToISO('20260627')).toBe('2026-06-27');
    expect(isoToYmd('2026-06-27')).toBe('20260627');
  });

  it('isTodayYmd / isPastYmd relative to a reference date', () => {
    const ref = ymdToDate('20260627');
    expect(isTodayYmd('20260627', ref)).toBe(true);
    expect(isPastYmd('20260626', ref)).toBe(true);
    expect(isPastYmd('20260628', ref)).toBe(false);
  });
});
