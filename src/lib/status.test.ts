import { describe, it, expect } from 'vitest';
import { deriveSlots } from './status';
import type { Franja, Reservation } from './types';

const franjas: Franja[] = [
  { id: 106, slot: 'P1-1', start: '09:00', end: '10:00', order: 1 },
  { id: 107, slot: 'P1-2', start: '10:00', end: '11:30', order: 2 },
  { id: 108, slot: 'P1-3', start: '11:30', end: '13:00', order: 3 },
];

const res: Reservation[] = [
  { id: 1, slot: 'P1-2', fecha: '20260627', nombre: 'Ana', vivienda: 'P1-2' },
];

describe('deriveSlots', () => {
  it('marks occupied, free, and blocked-by-weekday', () => {
    // Saturday 20260627, weekday code S; block P1-3 on Saturdays
    const now = new Date(2026, 5, 27, 8, 0); // 08:00, before all slots
    const out = deriveSlots({
      fecha: '20260627',
      franjas, reservations: res,
      weekdayBlocks: { 'P1-3_S': true },
      dayBlocked: false,
      now,
    });
    expect(out.map((s) => s.status)).toEqual(['libre', 'ocupado', 'bloqueado']);
    expect(out[1].reservation?.nombre).toBe('Ana');
  });

  it('marks past slots when date is today and start time elapsed', () => {
    const now = new Date(2026, 5, 27, 10, 30); // after P1-1 and P1-2 start
    const out = deriveSlots({
      fecha: '20260627', franjas, reservations: [],
      weekdayBlocks: {}, dayBlocked: false, now,
    });
    expect(out[0].status).toBe('pasado'); // 09:00 elapsed
    expect(out[1].status).toBe('pasado'); // 10:00 elapsed
    expect(out[2].status).toBe('libre');  // 11:30 still upcoming
  });

  it('all slots bloqueado when whole day is blocked', () => {
    const now = new Date(2026, 5, 20, 8, 0);
    const out = deriveSlots({
      fecha: '20260628', franjas, reservations: [],
      weekdayBlocks: {}, dayBlocked: true, now,
    });
    expect(out.every((s) => s.status === 'bloqueado')).toBe(true);
  });

  it('past dates: occupied stays occupied, empties are pasado (view-only)', () => {
    const now = new Date(2026, 5, 27, 8, 0);
    const out = deriveSlots({
      fecha: '20260626', franjas, reservations: res /* P1-2 */,
      weekdayBlocks: {}, dayBlocked: false, now,
    });
    expect(out[0].status).toBe('pasado');
    expect(out[1].status).toBe('ocupado');
    expect(out[1].past).toBe(true);   // occupied but elapsed → no actions (no watch/cancel button)
    expect(out[2].status).toBe('pasado');
  });

  it('a future occupied slot is not past (watch allowed)', () => {
    const now = new Date(2026, 5, 27, 8, 0);   // before all slots, same day
    const out = deriveSlots({ fecha: '20260627', franjas, reservations: res /* P1-2 */, weekdayBlocks: {}, dayBlocked: false, now });
    expect(out[1].status).toBe('ocupado');
    expect(out[1].past).toBe(false);
  });
});
