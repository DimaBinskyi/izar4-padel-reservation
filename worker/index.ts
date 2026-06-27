import { diffSnapshots, chooseGrab, isWatchExpired, countWeekKeys, slotStartPassed, type Watch, type FranjaMap } from './logic';
import { sendPush, type PushSub, type Vapid } from './push';
import { buildPushText, type PushParams } from './pushText';

export interface Env {
  DEVICE_SECRET: string;
  VAPID_PUBLIC: string;
  VAPID_PRIVATE: string;
  VAPID_SUBJECT: string;
  KV: KVNamespace;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

const IZAR4 = 'https://izar4.es';
const TERM = 12;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-device-secret',
};

interface DeviceRecord {
  subscription: PushSub;
  profile: { nombre: string; vivienda: string; codigo: string };
  watches: Watch[];
  locale?: string;
  recentActions?: string[];
  prefs: { master: boolean; types: Record<string, boolean>; suppressSelf: boolean;
           quiet: { enabled: boolean; from: string; to: string; nightAllowed: Record<string, boolean> } };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (req.headers.get('x-device-secret') !== env.DEVICE_SECRET) return json({ error: 'unauthorized' }, 401);

      // app endpoints handled by the worker (not proxied)
      if (url.pathname === '/api/vapid') return json({ publicKey: env.VAPID_PUBLIC });

      if (url.pathname === '/api/subscribe' && req.method === 'POST') {
        const deviceId = url.searchParams.get('device') ?? '';
        if (!deviceId) return json({ ok: false, error: 'no device' }, 400);
        const body = (await req.json()) as DeviceRecord;
        await env.KV.put(`device:${deviceId}`, JSON.stringify(body));
        return json({ ok: true });
      }

      if (url.pathname === '/api/pull-grabbed' && req.method === 'GET') {
        const deviceId = url.searchParams.get('device') ?? '';
        const raw = await env.KV.get(`grabbed:${deviceId}`);
        if (raw) await env.KV.delete(`grabbed:${deviceId}`);
        return json({ grabbed: raw ? JSON.parse(raw) : [] });
      }

      // default: proxy to izar4. izar4's WAF 503s on concurrent bursts, so retry on 503,
      // and short-cache static-ish GETs in KV so warm loads barely touch the origin.
      const path = url.pathname.replace(/^\/api/, '');
      const isCacheableGet = req.method === 'GET' &&
        ['/wp/v2/franjas', '/wp/v2/bloqueos', '/wp/v2/bloqueos-fecha', '/app/v1/inmuebles'].some((p) => path.startsWith(p));
      const cacheKey = `cache:${path}${url.search}`;
      if (isCacheableGet) {
        const hit = await env.KV.get(cacheKey);
        if (hit !== null) return proxied(hit);
      }
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
      const upstream = await izar4Fetch(IZAR4 + path + url.search, {
        method: req.method,
        headers: { 'content-type': req.headers.get('content-type') ?? 'application/json' },
        body,
      });
      if (isCacheableGet && upstream.ok) {
        const text = await upstream.text();
        await env.KV.put(cacheKey, text, { expirationTtl: 60 });
        return proxied(text);
      }
      const headers = new Headers(upstream.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      ['content-encoding', 'content-length', 'transfer-encoding', 'content-range', 'set-cookie'].forEach((h) => headers.delete(h));
      headers.set('cache-control', 'no-store');
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = new Date();
    const minute = now.getMinutes();
    const hour = now.getHours();
    const night = hour < 7;                       // 00:00–07:00
    const due = night ? minute % 10 === 0 : minute % 2 === 0;
    if (!due) return;
    await runPoll(env, now);
  },
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...CORS } });
}

function proxied(bodyText: string): Response {
  return new Response(bodyText, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// Fetch izar4 with retry on 503 / network error (its WAF throttles concurrent bursts).
async function izar4Fetch(target: string, init: RequestInit): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(200 + attempt * 250 + Math.floor(Math.random() * 150));
    try {
      const res = await fetch(target, init);
      if (res.status !== 503) return res;
      last = res;
    } catch { /* network error → retry */ }
  }
  return last ?? new Response('upstream error', { status: 502 });
}

async function runPoll(env: Env, now: Date): Promise<void> {
  // 1. fetch franjas (times) + reservations across the horizon
  const franjasRaw = await (await fetch(`${IZAR4}/wp-json/wp/v2/franjas?per_page=100&recurso=${TERM}&_fields=id,title,acf`, { cache: 'no-store' })).json() as any[];
  const franjas: FranjaMap = {};
  for (const f of franjasRaw) franjas[f.title?.rendered ?? ''] = { start: (f.acf?.hora_inicio_franjas ?? '00:00').slice(0, 5) };

  const reservasRaw: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const pageRes = await fetch(`${IZAR4}/wp-json/wp/v2/reservas?per_page=100&page=${page}&recurso=${TERM}&_fields=id,acf`, { cache: 'no-store' });
    if (!pageRes.ok) break;
    const arr = await pageRes.json() as any[];
    reservasRaw.push(...arr);
    if (arr.length < 100) break;
  }
  const reservas = reservasRaw.filter((r) => r.acf).map((r) => ({
    fecha: String(r.acf.fecha_reservas).replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3$2$1'),
    slot: r.acf.id_franja_reservas, vivienda: r.acf.vivienda_reservas ?? '', nombre: r.acf.nombre_reservas ?? '',
  }));
  const occupied = reservas.map((r) => `${r.fecha}|${r.slot}`);

  // 2. diff vs snapshot (snapshot stores full reservas with owners)
  const prevRaw = await env.KV.get('snapshot');
  const prev: { fecha: string; slot: string; vivienda: string; nombre: string }[] = prevRaw ? JSON.parse(prevRaw) : [];
  const prevKeys = prev.map((r) => `${r.fecha}|${r.slot}`);
  const prevByKey = new Map(prev.map((r) => [`${r.fecha}|${r.slot}`, r]));
  const { freed } = diffSnapshots(prevKeys, occupied);
  await env.KV.put('snapshot', JSON.stringify(reservas));
  if (prev.length === 0) return; // first run: just seed the snapshot, no notifications

  const todayYmd = dateToYmd(now);
  const weekFreed = freed.filter((k) => { const d = k.split('|')[0]; return d >= todayYmd && d <= addDaysYmd(todayYmd, 7); });

  // 3. per device
  const list = await env.KV.list({ prefix: 'device:' });
  const vapid: Vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE };

  for (const k of list.keys) {
    const rec = JSON.parse((await env.KV.get(k.name))!) as DeviceRecord;
    if (!rec.prefs?.master) continue;
    const deviceId = k.name.slice('device:'.length);
    let changed = false;
    const grabbedOut: any[] = [];

    // 3a. auto-grab on active watches
    for (const watch of rec.watches.filter((w) => w.active)) {
      if (isWatchExpired(watch, franjas, now)) { watch.active = false; changed = true;
        await maybePush(rec, 'watchExpired', { fecha: watch.fecha }, vapid, now); continue; }
      const weekCount = countWeekKeys(reservas, rec.profile.vivienda, watch.fecha);
      const dayCount = reservas.filter((r) => r.vivienda.trim().toUpperCase() === rec.profile.vivienda.trim().toUpperCase() && r.fecha === watch.fecha).length;
      const slot = chooseGrab(watch, freed, { franjas, now, weekCount, dayCount, weeklyLimit: 3, dailyLimit: 1 });
      if (!slot) {
        if (weekCount >= 3) { watch.active = false; changed = true;
          await maybePush(rec, 'limitOff', {}, vapid, now); }
        continue;
      }
      const ok = await createReservation(rec.profile, watch.fecha, slot);
      if (ok.ok) {
        watch.active = false; changed = true;
        grabbedOut.push({ fecha: watch.fecha, slot, id: ok.id, codigo: rec.profile.codigo, start: franjas[slot]?.start ?? '' });
        await maybePush(rec, 'grabbed', { time: franjas[slot]?.start ?? '', fecha: watch.fecha }, vapid, now);
      }
    }

    // 3b. generic freed-slot notifications (next 7 days), excluding auto-grabbed-by-this-device
    if (rec.prefs.types.freed) {
      for (const key of weekFreed) {
        if (rec.prefs.suppressSelf && (rec.recentActions ?? []).includes(key)) continue;
        const [fecha, slot] = key.split('|');
        if (grabbedOut.some((g) => g.fecha === fecha && g.slot === slot)) continue;
        await maybePush(rec, 'freed', { time: franjas[slot]?.start ?? '', fecha }, vapid, now);
      }
    }

    // 3c. "my booking cancelled" — owner matched by vivienda + name, future only
    if (rec.prefs.types.myCancelled) {
      const v = rec.profile.vivienda.trim().toUpperCase();
      const n = rec.profile.nombre.trim().toLowerCase();
      for (const key of freed) {
        const owner = prevByKey.get(key);
        if (!owner) continue;
        if (owner.vivienda.trim().toUpperCase() !== v || owner.nombre.trim().toLowerCase() !== n) continue;
        const [fecha, slot] = key.split('|');
        if (slotStartPassed(fecha, slot, franjas, now)) continue;            // only future
        if (rec.prefs.suppressSelf && (rec.recentActions ?? []).includes(key)) continue;
        if (grabbedOut.some((g) => g.fecha === fecha && g.slot === slot)) continue;
        await maybePush(rec, 'myCancelled', { time: franjas[slot]?.start ?? '', fecha }, vapid, now);
      }
    }

    if (grabbedOut.length) {
      const existingRaw = await env.KV.get(`grabbed:${deviceId}`);
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      await env.KV.put(`grabbed:${deviceId}`, JSON.stringify([...existing, ...grabbedOut]));
    }
    if (changed) await env.KV.put(k.name, JSON.stringify(rec));
  }
}

async function maybePush(rec: DeviceRecord, type: string, params: PushParams, vapid: Vapid, now: Date): Promise<void> {
  if (!rec.prefs.types[type]) return;
  if (rec.prefs.quiet?.enabled) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const from = toMin(rec.prefs.quiet.from); const to = toMin(rec.prefs.quiet.to);
    const inQuiet = from <= to ? cur >= from && cur < to : cur >= from || cur < to;
    if (inQuiet && !rec.prefs.quiet.nightAllowed?.[type]) return;
  }
  const text = buildPushText(rec.locale ?? 'uk', type, params);
  await sendPush(rec.subscription, { title: text.title, body: text.body, url: '/' }, vapid);
}

async function createReservation(profile: { nombre: string; vivienda: string; codigo: string }, fecha: string, slot: string): Promise<{ ok: boolean; id?: number }> {
  const body = { titulo: `${fecha} - PADEL ${slot}`, idFranja: slot, fecha, nombre: profile.nombre, vivienda: profile.vivienda.toUpperCase(), codigo: profile.codigo, idTermino: TERM };
  const r = await fetch(`${IZAR4}/wp-json/app/v1/reservar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: number };
  return { ok: !!d.ok, id: d.id };
}

function dateToYmd(d: Date): string {
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)); d.setDate(d.getDate() + days);
  return dateToYmd(d);
}
