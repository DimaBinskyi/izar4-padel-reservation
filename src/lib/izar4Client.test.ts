import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFranjas, fetchReservations, fetchAllReservations, resetClientCaches } from './izar4Client';

beforeEach(() => { vi.restoreAllMocks(); resetClientCaches(); });

function mockJson(data: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}

describe('izar4Client', () => {
  it('maps franjas to domain Franja[]', async () => {
    mockJson([
      { id: 106, slug: 'p1-1', title: { rendered: 'P1-1' },
        acf: { hora_inicio_franjas: '09:00:00', hora_fin_franjas: '10:00:00', orden_franjas: 1 } },
    ]);
    const out = await fetchFranjas('secret');
    expect(out[0]).toEqual({ id: 106, slot: 'P1-1', start: '09:00', end: '10:00', order: 1 });
  });

  it('maps reservations and filters by date', async () => {
    mockJson([
      { id: 1, slug: '20260627-padel-p1-2', acf: {
        id_franja_reservas: 'P1-2', fecha_reservas: '20260627',
        nombre_reservas: 'Ana', vivienda_reservas: 'P1-2' } },
      { id: 2, slug: '20260628-padel-p1-1', acf: {
        id_franja_reservas: 'P1-1', fecha_reservas: '20260628',
        nombre_reservas: 'Bob', vivienda_reservas: 'P1-1' } },
    ]);
    const out = await fetchReservations('secret', '20260627');
    expect(out).toHaveLength(1);
    expect(out[0].nombre).toBe('Ana');
  });

  it('falls back to a direct izar4 read when the Worker snapshot is unavailable (e.g. 401)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).startsWith('/api/')
      ? new Response('{"error":"unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify([{ id: 7, acf: { id_franja_reservas: 'P1-7', fecha_reservas: '20261008', nombre_reservas: 'Dmytro', vivienda_reservas: 'P3-7' } }]),
        { status: 200, headers: { 'content-type': 'application/json' } }));
    const { reservas } = await fetchAllReservations('secret');
    expect(reservas).toEqual([{ id: 7, slot: 'P1-7', fecha: '20261008', nombre: 'Dmytro', vivienda: 'P3-7' }]);
    expect(String(spy.mock.calls[1][0])).toContain('izar4.es/wp-json/wp/v2/reservas');
  });

  it('a direct read that fails mid-pagination throws instead of returning a partial list', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: i, acf: { id_franja_reservas: 'P1-1', fecha_reservas: '20261008', nombre_reservas: 'X', vivienda_reservas: 'A1' } }));
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/')) return new Response('{"error":"unauthorized"}', { status: 401 });
      return ++n === 1 ? new Response(JSON.stringify(page), { status: 200 }) : new Response('busy', { status: 503 });
    });
    await expect(fetchAllReservations('secret')).rejects.toThrow();
  });

  it('reads directly from izar4 (no device secret on direct calls)', async () => {
    const spy = mockJson([]);
    await fetchFranjas('secret');
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('izar4.es/wp-json/wp/v2/franjas');   // direct, not the Worker proxy
    const headers = (spy.mock.calls[0][1] as RequestInit)?.headers as Record<string, string> | undefined;
    expect(headers?.['x-device-secret']).toBeUndefined();       // izar4 doesn't accept that header
  });
});
