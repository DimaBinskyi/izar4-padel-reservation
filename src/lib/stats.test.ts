import { describe, it, expect } from 'vitest';
import { periodRange, aggregate } from './stats';
import type { BookingRecord } from './bookingsDb';

function rec(over: Partial<BookingRecord>): BookingRecord {
  return {
    key: `${over.fecha}|${over.slot}`, reservaId: 1, fecha: '20260615', slot: 'P1-8',
    start: '19:00', end: '20:30', nombre: 'D', vivienda: 'P3-7', codigoUsed: 'c',
    origin: 'app', status: 'active', createdAt: 1, ...over,
  } as BookingRecord;
}

describe('periodRange', () => {
  it('month range for June 2026', () => {
    expect(periodRange('month', '20260615')).toEqual({ from: '20260601', to: '20260630' });
  });
  it('week range (Mon..Sun) for a Saturday', () => {
    expect(periodRange('week', '20260627')).toEqual({ from: '20260622', to: '20260628' });
  });
  it('all range is unbounded', () => {
    expect(periodRange('all', '20260615')).toEqual({ from: '00000000', to: '99999999' });
  });
});

describe('aggregate', () => {
  const today = '20260615';
  const recs: BookingRecord[] = [
    rec({ fecha: '20260610', slot: 'P1-8', status: 'active' }),   // played (past, active), 1.5h
    rec({ fecha: '20260612', slot: 'P1-8', status: 'cancelled' }),// cancelled
    rec({ fecha: '20260620', slot: 'P1-1', start: '09:00', end: '10:00', status: 'active' }), // upcoming 1h
    rec({ fecha: '20260620', slot: 'P1-8', origin: 'auto', status: 'active' }), // upcoming auto 1.5h
    rec({ fecha: '20260505', slot: 'P1-8', status: 'active' }),   // outside month
  ];

  it('counts within the month period', () => {
    const r = aggregate(recs, periodRange('month', today), today);
    expect(r.total).toBe(4);        // excludes the May one
    expect(r.cancelled).toBe(1);
    expect(r.played).toBe(1);       // 20260610 active & past
    expect(r.upcoming).toBe(2);     // two on 20260620
    expect(r.autoGrabbed).toBe(1);
    expect(r.favouriteSlot).toBe('P1-8'); // appears most among active
    expect(r.hours).toBeCloseTo(1.5 + 1 + 1.5); // active only: 4.0
  });
});
