import { API_BASE, APP_API_BASE, PADEL_TERM_ID } from '../config';
import type { Franja, Reservation, DayBlock, WeekdayBlockSet } from './types';
import { normalizeYmd } from './dates';

function get(path: string, secret: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    headers: { 'x-device-secret': secret },
    cache: 'no-store',
  });
}

export async function fetchFranjas(secret: string): Promise<Franja[]> {
  const r = await get(`/wp/v2/franjas?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,slug,title,acf`, secret);
  const data = (await r.json()) as any[];
  return data.map((f) => ({
    id: Number(f.id),
    slot: f.title?.rendered ?? f.slug,
    start: (f.acf?.hora_inicio_franjas ?? '--:--').slice(0, 5),
    end: (f.acf?.hora_fin_franjas ?? '--:--').slice(0, 5),
    order: Number(f.acf?.orden_franjas ?? 999),
  }));
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

export async function fetchWeekdayBlocks(secret: string): Promise<WeekdayBlockSet> {
  const r = await get(`/wp/v2/bloqueos?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,acf`, secret);
  const data = (await r.json()) as any[];
  const set: WeekdayBlockSet = {};
  for (const b of data) {
    const slot = b.acf?.id_franja_bloqueos;
    const dia = b.acf?.dia_semana_bloqueos;
    if (slot && dia) set[`${slot}_${dia}`] = true;
  }
  return set;
}

export async function fetchDayBlock(secret: string, fecha: string): Promise<DayBlock | null> {
  const r = await get(`/wp/v2/bloqueos-fecha?per_page=100&recurso=${PADEL_TERM_ID}&_fields=id,acf`, secret);
  const data = (await r.json()) as any[];
  const hit = data.find((b) => b.acf && normalizeYmd(b.acf['fecha_bloqueo_bloqueos-fecha']) === fecha);
  return hit ? { motivo: hit.acf['motivo_bloqueos-fecha'] ?? '' } : null;
}

export async function fetchInmuebles(secret: string): Promise<string[]> {
  const r = await fetch(`${APP_API_BASE}/inmuebles?tipo=vivienda`, {
    headers: { 'x-device-secret': secret }, cache: 'no-store',
  });
  const d = (await r.json()) as { ok?: boolean; inmuebles?: { label: string }[] };
  return d.ok && d.inmuebles ? d.inmuebles.map((i) => i.label) : [];
}

export interface CreateInput {
  fecha: string; slot: string; nombre: string; vivienda: string; codigo: string;
}

export async function createReservation(secret: string, input: CreateInput): Promise<{ ok: boolean; id?: number }> {
  const vivienda = input.vivienda.trim().toUpperCase();
  const body = {
    titulo: `${input.fecha} - PADEL ${input.slot}`,
    idFranja: input.slot,
    fecha: input.fecha,
    nombre: input.nombre.trim(),
    vivienda,
    codigo: input.codigo,
    idTermino: PADEL_TERM_ID,
  };
  const r = await fetch(`${APP_API_BASE}/reservar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-secret': secret },
    body: JSON.stringify(body),
  });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: number };
  return { ok: !!d.ok, id: d.id };
}

export async function cancelReservation(secret: string, idReserva: number, codigo: string): Promise<{ ok: boolean; code?: string }> {
  const r = await fetch(`${APP_API_BASE}/cancelar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-secret': secret },
    body: JSON.stringify({ idReserva, codigo }),
  });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string };
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
