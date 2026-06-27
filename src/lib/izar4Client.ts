import { API_BASE, PADEL_TERM_ID } from '../config';
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
