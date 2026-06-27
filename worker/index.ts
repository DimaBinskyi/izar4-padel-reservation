export interface Env {
  DEVICE_SECRET: string;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

const IZAR4 = 'https://izar4.es';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-device-secret',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      if (req.headers.get('x-device-secret') !== env.DEVICE_SECRET) {
        return new Response('unauthorized', { status: 401, headers: CORS });
      }

      const target = IZAR4 + url.pathname.replace(/^\/api/, '') + url.search;
      const init: RequestInit = {
        method: req.method,
        headers: { 'content-type': req.headers.get('content-type') ?? 'application/json' },
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
      };
      const upstream = await fetch(target, init);
      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return env.ASSETS.fetch(req);
  },
};
