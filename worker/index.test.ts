import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index';

const ENV = { DEVICE_SECRET: 's3cret', VAPID_PUBLIC: 'p', VAPID_PRIVATE: 'k', VAPID_SUBJECT: 'mailto:x', KV: {} as any, ASSETS: { fetch: async () => new Response('asset') } } as any;

beforeEach(() => vi.restoreAllMocks());

describe('worker proxy', () => {
  it('rejects /api without the device secret', async () => {
    const res = await worker.fetch(new Request('https://app.dev/api/wp-json/wp/v2/reservas'), ENV);
    expect(res.status).toBe(401);
  });

  it('proxies /api/* to izar4 with secret present', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('[{"id":1}]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const req = new Request('https://app.dev/api/wp-json/wp/v2/reservas?recurso=12', {
      headers: { 'x-device-secret': 's3cret' },
    });
    const res = await worker.fetch(req, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const calledUrl = (spy.mock.calls[0][0] as Request).url ?? spy.mock.calls[0][0];
    expect(String(calledUrl)).toBe('https://izar4.es/wp-json/wp/v2/reservas?recurso=12');
  });

  it('answers CORS preflight', async () => {
    const res = await worker.fetch(
      new Request('https://app.dev/api/wp-json/app/v1/reservar', { method: 'OPTIONS' }), ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('falls through to static assets for non-/api paths', async () => {
    const res = await worker.fetch(new Request('https://app.dev/index.html'), ENV);
    expect(await res.text()).toBe('asset');
  });

  it('keeps the last good snapshot when a live /api/reservas fetch fails (no empty-slot poisoning)', async () => {
    const store = new Map<string, string>([['snapshot', '[{"id":7,"fecha":"20260703","slot":"P1-1"}]']]);
    const env = { ...ENV, KV: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } } } as any;
    // izar4 returns a non-503 error → fetchReservasPaged() returns null → fall back to the snapshot.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream down', { status: 500 }));
    const req = new Request('https://app.dev/api/reservas?live=1', { headers: { 'x-device-secret': 's3cret' } });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toEqual([{ id: 7, fecha: '20260703', slot: 'P1-1' }]);
    expect(store.get('snapshot')).toBe('[{"id":7,"fecha":"20260703","slot":"P1-1"}]'); // not overwritten
  });

  it('stores and returns the fresh list when a live /api/reservas fetch succeeds', async () => {
    const store = new Map<string, string>();
    const env = { ...ENV, KV: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } } } as any;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify([{ id: 9, acf: { fecha_reservas: '03/07/2026', id_franja_reservas: 'P1-2', vivienda_reservas: 'A1', nombre_reservas: 'Test' } }]),
      { status: 200, headers: { 'content-type': 'application/json' } }));
    const req = new Request('https://app.dev/api/reservas?live=1', { headers: { 'x-device-secret': 's3cret' } });
    const res = await worker.fetch(req, env);
    expect(JSON.parse(await res.text())).toEqual([{ id: 9, fecha: '20260703', slot: 'P1-2', vivienda: 'A1', nombre: 'Test' }]);
    expect(store.get('snapshot')).toBe(JSON.stringify([{ id: 9, fecha: '20260703', slot: 'P1-2', vivienda: 'A1', nombre: 'Test' }]));
  });

  it('forwards POST body to izar4 with secret', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"ok":true,"id":99}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const body = JSON.stringify({ idFranja: 'P1-1', fecha: '20260703' });
    const req = new Request('https://app.dev/api/wp-json/app/v1/reservar', {
      method: 'POST',
      headers: { 'x-device-secret': 's3cret', 'content-type': 'application/json' },
      body,
    });
    const res = await worker.fetch(req, ENV);
    expect(res.status).toBe(200);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(body);
  });

  it('a successful book patches the snapshot in place (so the client can refresh from snapshot, not a full live re-fetch)', async () => {
    const store = new Map<string, string>([['snapshot', '[]']]);
    const env = { ...ENV, KV: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } } } as any;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true,"id":99}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const body = JSON.stringify({ idFranja: 'P1-1', fecha: '20260703', nombre: 'Ana', vivienda: 'a1', idTermino: 12 });
    const req = new Request('https://app.dev/api/wp-json/app/v1/reservar', { method: 'POST', headers: { 'x-device-secret': 's3cret', 'content-type': 'application/json' }, body });
    const res = await worker.fetch(req, env);
    expect(JSON.parse(await res.text())).toEqual({ ok: true, id: 99 });
    expect(JSON.parse(store.get('snapshot')!)).toEqual([{ id: 99, fecha: '20260703', slot: 'P1-1', vivienda: 'A1', nombre: 'Ana' }]);
  });

  it('a successful cancel removes the reservation from the snapshot', async () => {
    const seed = [{ id: 5, fecha: '20260703', slot: 'P1-1', vivienda: 'A1', nombre: 'Ana' }, { id: 6, fecha: '20260704', slot: 'P1-2', vivienda: 'B2', nombre: 'Bob' }];
    const store = new Map<string, string>([['snapshot', JSON.stringify(seed)]]);
    const env = { ...ENV, KV: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } } } as any;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const body = JSON.stringify({ idReserva: 5, codigo: 'x' });
    const req = new Request('https://app.dev/api/wp-json/app/v1/cancelar', { method: 'POST', headers: { 'x-device-secret': 's3cret', 'content-type': 'application/json' }, body });
    await worker.fetch(req, env);
    expect(JSON.parse(store.get('snapshot')!)).toEqual([{ id: 6, fecha: '20260704', slot: 'P1-2', vivienda: 'B2', nombre: 'Bob' }]);
  });
});
