import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index';

const ENV = { DEVICE_SECRET: 's3cret', ASSETS: { fetch: async () => new Response('asset') } } as any;

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
});
