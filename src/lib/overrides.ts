import type { Reservation } from './types';

// Client-side optimistic overrides for the user's own writes. izar4 (list) and Cloudflare KV both
// have read-after-write lag, so right after a booking/cancel a fetch may still show stale data.
// We apply the user's pending action on top of fetched reservations and self-heal each override
// once the fetched data agrees with it.
interface Override { key: string; type: 'add' | 'remove'; res?: Reservation; ts: number }

const KEY = 'padel_overrides';
// Bridges only the brief read-after-write lag (izar4 list / KV) until the patched snapshot reflects
// the write. Kept short so an externally-cancelled booking isn't masked for long (it self-heals as
// soon as a fetch agrees, or expires here).
const WINDOW_MS = 60 * 1000;

function load(): Override[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as Override[]).filter((o) => Date.now() - o.ts < WINDOW_MS);
  } catch {
    return [];
  }
}
function save(list: Override[]): void { localStorage.setItem(KEY, JSON.stringify(list)); }

export function addOverride(o: { key: string; type: 'add' | 'remove'; res?: Reservation }): void {
  const list = load().filter((x) => x.key !== o.key);
  list.push({ ...o, ts: Date.now() });
  save(list);
}

export function applyOverrides(reservas: Reservation[]): Reservation[] {
  const list = load();
  if (!list.length) return reservas;
  const has = new Set(reservas.map((r) => `${r.fecha}|${r.slot}`));
  let result = reservas;
  const stillPending: Override[] = [];
  for (const o of list) {
    const present = has.has(o.key);
    if (o.type === 'remove') {
      if (present) { result = result.filter((r) => `${r.fecha}|${r.slot}` !== o.key); stillPending.push(o); }
    } else if (!present && o.res) {
      result = [...result, o.res];
      stillPending.push(o);
    }
  }
  save(stillPending);
  return result;
}
