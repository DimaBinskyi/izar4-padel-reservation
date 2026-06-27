import { describe, it, expect, beforeEach } from 'vitest';
import { recordBooking, getBookingCode, markCancelled, listBookings, type BookingRecord } from './bookingsDb';

function rec(over: Partial<BookingRecord> = {}): BookingRecord {
  return {
    key: '20260627|P1-1', reservaId: 1, fecha: '20260627', slot: 'P1-1',
    start: '09:00', end: '10:00', nombre: 'Dmytro', vivienda: 'P3-7',
    codigoUsed: 'sol24', origin: 'app', status: 'active', createdAt: 1, ...over,
  };
}

beforeEach(async () => {
  indexedDB.deleteDatabase('padel');
});

describe('bookingsDb', () => {
  it('records a booking and reads its code back by date+slot', async () => {
    await recordBooking(rec());
    expect(await getBookingCode('20260627', 'P1-1')).toBe('sol24');
  });

  it('returns null code for an unknown booking', async () => {
    expect(await getBookingCode('20260101', 'P1-9')).toBeNull();
  });

  it('marks a booking cancelled and lists reflect status', async () => {
    await recordBooking(rec());
    await markCancelled('20260627', 'P1-1', 2);
    const all = await listBookings();
    expect(all[0].status).toBe('cancelled');
    expect(all[0].cancelledAt).toBe(2);
  });
});
