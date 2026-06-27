import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type BookingOrigin = 'app' | 'auto' | 'izar4' | 'unknown';
export type BookingStatus = 'active' | 'cancelled';

export interface BookingRecord {
  key: string;          // `${fecha}|${slot}`
  reservaId: number;
  fecha: string;        // YYYYMMDD
  slot: string;         // e.g. P1-1
  start: string;        // HH:MM
  end: string;          // HH:MM
  nombre: string;
  vivienda: string;
  codigoUsed: string;   // the code used to create this booking
  origin: BookingOrigin;
  status: BookingStatus;
  createdAt: number;
  cancelledAt?: number;
}

interface Schema extends DBSchema {
  bookings: { key: string; value: BookingRecord };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<Schema>('padel', 1, {
      upgrade(d) { d.createObjectStore('bookings', { keyPath: 'key' }); },
    });
  }
  return dbp;
}

export function bookingKey(fecha: string, slot: string): string {
  return `${fecha}|${slot}`;
}

export async function recordBooking(r: BookingRecord): Promise<void> {
  await (await db()).put('bookings', r);
}

export async function getBookingCode(fecha: string, slot: string): Promise<string | null> {
  const r = await (await db()).get('bookings', bookingKey(fecha, slot));
  return r ? r.codigoUsed : null;
}

export async function markCancelled(fecha: string, slot: string, when: number): Promise<void> {
  const d = await db();
  const r = await d.get('bookings', bookingKey(fecha, slot));
  if (r) { r.status = 'cancelled'; r.cancelledAt = when; await d.put('bookings', r); }
}

export async function listBookings(): Promise<BookingRecord[]> {
  return (await db()).getAll('bookings');
}
