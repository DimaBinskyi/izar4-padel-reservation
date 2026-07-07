import { getDeviceSecret, getDeviceId } from './deviceSecret';
import { WORKER_BASE } from '../config';
import { recordBooking, bookingKey, markCancelled, getBookingCode } from './bookingsDb';
import { removeWatchBySlot } from './watchlist';
import { cancelReservation } from './izar4Client';

interface Grabbed {
  fecha: string; slot: string; id: number; codigo: string; start: string;
  overwrite?: boolean; oldId?: number; oldSlot?: string; oldCancelled?: boolean;   // overwrite swap bookkeeping
}

export async function pullGrabbed(): Promise<number> {
  const r = await fetch(`${WORKER_BASE}/api/pull-grabbed?device=${encodeURIComponent(getDeviceId())}`, {
    headers: { 'x-device-secret': getDeviceSecret() }, cache: 'no-store',
  });
  const d = (await r.json().catch(() => ({ grabbed: [] }))) as { grabbed: Grabbed[] };
  for (const g of d.grabbed) {
    await recordBooking({
      key: bookingKey(g.fecha, g.slot), reservaId: g.id, fecha: g.fecha, slot: g.slot,
      start: g.start, end: '', nombre: '', vivienda: '', codigoUsed: g.codigo, origin: 'auto',
      status: 'active', createdAt: Date.now(),
    });
    removeWatchBySlot(g.fecha, g.slot);   // the watch covering this grabbed slot did its job → clear it locally

    // Overwrite swap: the worker booked the new slot; reconcile the old same-day booking locally.
    if (g.overwrite && g.oldSlot) {
      if (g.oldCancelled) {
        await markCancelled(g.fecha, g.oldSlot, Date.now());   // worker already cancelled it → sync local state
      } else if (g.oldId) {
        // Worker couldn't cancel (profile code didn't match) → finish it with the code we saved for that booking.
        const code = await getBookingCode(g.fecha, g.oldSlot);
        if (code) {
          const res = await cancelReservation(getDeviceSecret(), g.oldId, code);
          if (res.ok) await markCancelled(g.fecha, g.oldSlot, Date.now());
        }
      }
    }
  }
  return d.grabbed.length;
}
