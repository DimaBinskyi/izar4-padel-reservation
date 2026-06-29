import { IZAR4_BASE, IZAR4_APP_BASE, API_BASE, APP_API_BASE, PADEL_TERM_ID } from '../config';
import type { Franja, Reservation, DayBlock, WeekdayBlockSet } from './types';
import { normalizeYmd } from './dates';

// GET izar4 DIRECTLY from the user's IP (fast; izar4 allows our origin via CORS). No device secret —
// izar4 doesn't accept that header and reads are public. Falls back to the Worker proxy on any failure.
async function get(path: string, secret: string): Promise<Response> {
  try {
    const r = await fetch(`${IZAR4_BASE}${path}`, { cache: 'no-store' });
    if (r.ok) return r;
  } catch { /* CORS/network/offline → fall back to the Worker proxy */ }
  return fetch(`${API_BASE}${path}`, { headers: { 'x-device-secret': secret }, cache: 'no-store' });
}

// Static-ish data (franjas, weekday blocks, dwellings) rarely changes — cache per session to
// avoid re-hitting izar4 (whose WAF throttles concurrent bursts) on every screen load.
let _franjasCache: Franja[] | null = null;

export async function fetchFranjas(secret: string): Promise<Franja[]> {
  if (_franjasCache) return _franjasCache;
  const r = await get(`/wp/v2/franjas?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,slug,title,acf`, secret);
  const data = (await r.json()) as any[];
  _franjasCache = data.map((f) => ({
    id: Number(f.id),
    slot: f.title?.rendered ?? f.slug,
    start: (f.acf?.hora_inicio_franjas ?? '--:--').slice(0, 5),
    end: (f.acf?.hora_fin_franjas ?? '--:--').slice(0, 5),
    order: Number(f.acf?.orden_franjas ?? 999),
  }));
  return _franjasCache;
}

export async function fetchReservations(secret: string, fecha: string): Promise<Reservation[]> {
  const r = await get(`/wp/v2/reservas?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,slug,acf`, secret);
  const data = (await r.json()) as any[];
  return data
    .filter((x) => x.acf && normalizeYmd(x.acf.fecha_reservas) === fecha)
    .map((x) => ({
      id: Number(x.id),
      slot: x.acf.id_franja_reservas,
      fecha: normalizeYmd(x.acf.fecha_reservas),
      nombre: x.acf.nombre_reservas ?? '',
      vivienda: x.acf.vivienda_reservas ?? '',
    }));
}

let _blocksCache: WeekdayBlockSet | null = null;

export async function fetchWeekdayBlocks(secret: string): Promise<WeekdayBlockSet> {
  if (_blocksCache) return _blocksCache;
  const r = await get(`/wp/v2/bloqueos?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,acf`, secret);
  const data = (await r.json()) as any[];
  const set: WeekdayBlockSet = {};
  for (const b of data) {
    const slot = b.acf?.id_franja_bloqueos;
    const dia = b.acf?.dia_semana_bloqueos;
    if (slot && dia) set[`${slot}_${dia}`] = true;
  }
  _blocksCache = set;
  return set;
}

export async function fetchDayBlock(secret: string, fecha: string): Promise<DayBlock | null> {
  const r = await get(`/wp/v2/bloqueos-fecha?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,acf`, secret);
  const data = (await r.json()) as any[];
  const hit = data.find((b) => b.acf && normalizeYmd(b.acf['fecha_bloqueo_bloqueos-fecha']) === fecha);
  return hit ? { motivo: hit.acf['motivo_bloqueos-fecha'] ?? '' } : null;
}

let _inmueblesCache: string[] | null = null;

// All date-blocks as a map { YYYYMMDD: motivo } — lets any day be checked without a per-date fetch.
export async function fetchDayBlocks(secret: string): Promise<Record<string, string>> {
  const r = await get(`/wp/v2/bloqueos-fecha?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,acf`, secret);
  const data = (await r.json()) as any[];
  const map: Record<string, string> = {};
  for (const b of data) {
    if (!b.acf) continue;
    const f = normalizeYmd(b.acf['fecha_bloqueo_bloqueos-fecha']);
    if (f) map[f] = b.acf['motivo_bloqueos-fecha'] ?? '';
  }
  return map;
}

export async function fetchInmuebles(secret: string): Promise<string[]> {
  if (_inmueblesCache) return _inmueblesCache;
  const r = await fetch(`${APP_API_BASE}/inmuebles?tipo=vivienda`, {
    headers: { 'x-device-secret': secret }, cache: 'no-store',
  });
  const d = (await r.json()) as { ok?: boolean; inmuebles?: { label: string }[] };
  _inmueblesCache = d.ok && d.inmuebles ? d.inmuebles.map((i) => i.label) : [];
  return _inmueblesCache;
}

export interface CreateInput {
  fecha: string; slot: string; nombre: string; vivienda: string; codigo: string;
}

// POST an app/v1 write DIRECTLY to izar4 (user's fast IP; CORS allows it). A real answer (incl. an
// app-level 4xx/rejection) is used as-is; only a network/CORS error or 5xx falls back to the Worker.
async function appPost(path: string, body: unknown, secret: string): Promise<any> {
  const payload = JSON.stringify(body);
  try {
    const r = await fetch(`${IZAR4_APP_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
    if (r.status < 500) return await r.json().catch(() => ({}));
  } catch { /* network/CORS → fall back to the Worker proxy */ }
  const r = await fetch(`${APP_API_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-secret': secret }, body: payload });
  return await r.json().catch(() => ({}));
}

export async function createReservation(secret: string, input: CreateInput): Promise<{ ok: boolean; id?: number }> {
  const d = (await appPost('/reservar', {
    titulo: `${input.fecha} - PADEL ${input.slot}`,
    idFranja: input.slot,
    fecha: input.fecha,
    nombre: input.nombre.trim(),
    vivienda: input.vivienda.trim().toUpperCase(),
    codigo: input.codigo,
    idTermino: PADEL_TERM_ID,
  }, secret)) as { ok?: boolean; id?: number };
  return { ok: !!d.ok, id: d.id };
}

export async function cancelReservation(secret: string, idReserva: number, codigo: string): Promise<{ ok: boolean; code?: string }> {
  const d = (await appPost('/cancelar', { idReserva, codigo }, secret)) as { ok?: boolean; code?: string };
  return { ok: !!d.ok, code: d.code };
}

// Used ONLY by the cancel flow to compare against the user's own profile code.
// The value is never rendered in the UI (see spec §7.3/§14).
export async function fetchReservationCode(secret: string, idReserva: number): Promise<string> {
  const r = await fetch(`${API_BASE}/wp/v2/reservas/${idReserva}?_fields=id,acf`, {
    headers: { 'x-device-secret': secret }, cache: 'no-store',
  });
  const d = (await r.json().catch(() => ({}))) as { acf?: { codigo_cancelacion_reservas?: string } };
  return d.acf?.codigo_cancelacion_reservas ?? '';
}

/** Test helper: clear the session caches so each test starts fresh. */
export function resetClientCaches(): void {
  _franjasCache = null;
  _blocksCache = null;
  _inmueblesCache = null;
}

// Reads from the Worker's cron-maintained KV snapshot (fast). Pass live=true to force a fresh
// fetch (used right after a booking/cancel). Snapshot items are already {id,fecha,slot,vivienda,nombre}.
// Returns the parsed reservations plus `ts` = when the snapshot was made (ms epoch, 0 if unknown),
// so the UI can show "cached at …".
export async function fetchAllReservations(secret: string, live = false): Promise<{ reservas: Reservation[]; ts: number }> {
  if (live) {
    try {
      const reservas = await fetchReservasDirect();   // direct from the user's fast IP
      void pushSnapshot(secret, reservas);            // best-effort: keep the Worker's snapshot fresh
      return { reservas, ts: Date.now() };
    } catch { return fetchSnapshot(secret, true); }    // direct failed → Worker's live fetch
  }
  return fetchSnapshot(secret, false);                 // fast cache read
}

// Read the Worker's KV snapshot (fast cache). Items are flat {id,fecha,slot,vivienda,nombre}.
async function fetchSnapshot(secret: string, live: boolean): Promise<{ reservas: Reservation[]; ts: number }> {
  const r = await fetch(`/api/reservas?live=${live ? '1' : '0'}`, { headers: { 'x-device-secret': secret }, cache: 'no-store' });
  const ts = Number(r.headers.get('x-snapshot-ts') ?? 0);
  const data = (await r.json()) as any[];
  const reservas = data
    .filter((x) => x && x.fecha && x.slot)
    .map((x) => ({ id: Number(x.id), slot: x.slot, fecha: String(x.fecha), nombre: x.nombre ?? '', vivienda: x.vivienda ?? '' }));
  return { reservas, ts };
}

// Paginated DIRECT fetch of all padel reservations from izar4 (acf shape). Sequential on purpose —
// izar4's WAF 503s on concurrent same-endpoint bursts even from a user IP.
async function fetchReservasDirect(): Promise<Reservation[]> {
  const raw: any[] = [];
  for (let p = 1; p <= 5; p++) {
    const r = await fetch(`${IZAR4_BASE}/wp/v2/reservas?per_page=100&page=${p}&recurso=${PADEL_TERM_ID}&_fields=id,acf`, { cache: 'no-store' });
    if (r.status === 400) break;                       // past the last page
    if (!r.ok) { if (p === 1) throw new Error('reservas direct failed'); break; }
    const arr = (await r.json()) as any[];
    raw.push(...arr);
    if (arr.length < 100) break;
  }
  return raw.filter((x) => x.acf).map((x) => ({
    id: Number(x.id),
    slot: x.acf.id_franja_reservas,
    fecha: normalizeYmd(String(x.acf.fecha_reservas)),
    nombre: x.acf.nombre_reservas ?? '',
    vivienda: x.acf.vivienda_reservas ?? '',
  }));
}

// Feed the Worker the fresh list so its snapshot (cron baseline + push owner-match + fast cache) stays
// current without the Worker polling izar4 from its throttled IP.
export async function pushSnapshot(secret: string, reservas: Reservation[]): Promise<void> {
  try {
    await fetch(`/api/snapshot`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-device-secret': secret },
      body: JSON.stringify(reservas), cache: 'no-store',
    });
  } catch { /* best-effort */ }
}
