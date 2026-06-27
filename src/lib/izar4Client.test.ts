import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFranjas, fetchReservations, resetClientCaches } from './izar4Client';

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

  it('sends the device secret header', async () => {
    const spy = mockJson([]);
    await fetchFranjas('secret');
    const req = spy.mock.calls[0][0] as Request;
    const headers = (spy.mock.calls[0][1] as RequestInit)?.headers as Record<string, string> | undefined;
    const sent = headers?.['x-device-secret'] ?? new Headers(req.headers).get('x-device-secret');
    expect(sent).toBe('secret');
  });
});
