import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchInmuebles, createReservation, cancelReservation, fetchReservationCode } from './izar4Client';

beforeEach(() => vi.restoreAllMocks());
function mock(data: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('izar4Client writes', () => {
  it('fetchInmuebles returns labels', async () => {
    mock({ ok: true, inmuebles: [{ label: 'P1-1' }, { label: 'P3-7' }] });
    expect(await fetchInmuebles('s')).toEqual(['P1-1', 'P3-7']);
  });

  it('createReservation posts the correct body and returns id', async () => {
    const spy = mock({ ok: true, id: 1530 });
    const res = await createReservation('s', { fecha: '20260703', slot: 'P1-1', nombre: 'Dmytro', vivienda: 'p3-7', codigo: 'sol24' });
    expect(res).toEqual({ ok: true, id: 1530 });
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('izar4.es/wp-json/app/v1/reservar');   // direct write to izar4
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      titulo: '20260703 - PADEL P1-1', idFranja: 'P1-1', fecha: '20260703',
      nombre: 'Dmytro', vivienda: 'P3-7', codigo: 'sol24', idTermino: 12,
    });
    expect((init.headers as Record<string, string>)['x-device-secret']).toBeUndefined();   // direct calls carry no device secret
  });

  it('cancelReservation posts id + code and maps wrong-code', async () => {
    mock({ ok: false, code: 'codigo_incorrecto' });
    const r = await cancelReservation('s', 1530, 'nope');
    expect(r).toEqual({ ok: false, code: 'codigo_incorrecto' });
  });

  it('fetchReservationCode returns the cancellation code for an id', async () => {
    mock({ id: 1530, acf: { codigo_cancelacion_reservas: 'sol24' } });
    expect(await fetchReservationCode('s', 1530)).toBe('sol24');
  });
});
