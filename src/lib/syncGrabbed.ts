import { getDeviceSecret, getDeviceId } from './deviceSecret';
import { WORKER_BASE } from '../config';
import { recordBooking, bookingKey } from './bookingsDb';
import { removeWatch } from './watchlist';

export async function pullGrabbed(): Promise<number> {
  const r = await fetch(`${WORKER_BASE}/api/pull-grabbed?device=${encodeURIComponent(getDeviceId())}`, {
    headers: { 'x-device-secret': getDeviceSecret() }, cache: 'no-store',
  });
  const d = (await r.json().catch(() => ({ grabbed: [] }))) as { grabbed: { fecha: string; slot: string; id: number; codigo: string; start: string }[] };
  for (const g of d.grabbed) {
    await recordBooking({
      key: bookingKey(g.fecha, g.slot), reservaId: g.id, fecha: g.fecha, slot: g.slot,
      start: g.start, end: '', nombre: '', vivienda: '', codigoUsed: g.codigo, origin: 'auto',
      status: 'active', createdAt: Date.now(),
    });
    removeWatch(g.fecha);   // the watch did its job (auto-grabbed) → clear it locally so it stops showing as active
  }
  return d.grabbed.length;
}
