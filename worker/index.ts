import { diffSnapshots, chooseGrab, isWatchExpired, countWeekKeys, slotStartPassed, appendCancelLog, type Watch, type FranjaMap, type CancelLogEntry } from './logic';
import { sendPush, type PushSub, type Vapid } from './push';
import { buildPushText, type PushParams } from './pushText';
import { buildIcs } from '../src/lib/ics';

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

    // Public (no auth) .ics endpoint for the "add to calendar" feature. Builds a calendar event
    // purely from query params (no KV/izar4 access → nothing sensitive to expose) and serves it as a
    // text/calendar ATTACHMENT so the OS hands it to the Calendar app without navigating away from
    // the installed PWA. Auth can't apply here: the client reaches it via a plain link, not fetch.
    if (url.pathname === '/ics' && req.method === 'GET') {
      const p = url.searchParams;
      const ics = buildIcs({
        title: p.get('t') ?? 'Pádel',
        fecha: p.get('d') ?? '',
        start: p.get('s') ?? '',
        end: p.get('e') ?? '',
        location: p.get('loc') ?? '',
        description: p.get('desc') ?? '',
        uid: p.get('uid') ?? '',
      });
      return new Response(ics, { status: 200, headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="padel.ics"',
        'cache-control': 'no-store',
      } });
    }

    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (req.headers.get('x-device-secret') !== env.DEVICE_SECRET) return json({ error: 'unauthorized' }, 401);

      // app endpoints handled by the worker (not proxied)
      if (url.pathname === '/api/vapid') return json({ publicKey: env.VAPID_PUBLIC });

      // Manual test push (secret-gated). Sends freed/grabbed/myCancelled (or ?type=) to every subscribed
      // device, each carrying a real franja focus so you can tap it and verify the deep-link + blink.
      // Bypasses prefs/quiet-hours on purpose. Override with ?type=&fecha=YYYYMMDD&slot=P1-6.
      if (url.pathname === '/api/test-push' && req.method === 'GET') {
        const vapid: Vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE };
        const fRes = await izar4Fetch(`${IZAR4}/wp-json/wp/v2/franjas?per_page=100&recurso=${TERM}&_fields=id,title,acf`, { method: 'GET', headers: { 'content-type': 'application/json' } });
        const franjasRaw = (fRes.ok ? await fRes.json().catch(() => []) : []) as any[];
        const fmap: Record<string, string> = {};
        for (const f of franjasRaw) { const id = f.title?.rendered ?? ''; if (id) fmap[id] = (f.acf?.hora_inicio_franjas ?? '').slice(0, 5); }
        const slots = Object.keys(fmap);
        const fecha = url.searchParams.get('fecha') || dateToYmd(new Date());
        const wanted = url.searchParams.get('type');
        const types = wanted ? [wanted] : ['freed', 'grabbed', 'myCancelled'];
        const plan = types.map((type, i) => { const slot = url.searchParams.get('slot') || slots[i % Math.max(slots.length, 1)] || 'P1-6'; return { type, slot, time: fmap[slot] ?? '' }; });
        const list = await env.KV.list({ prefix: 'device:' });
        const seen = new Set<string>(); const sent: { device: string; type: string; slot: string; ok: boolean }[] = [];
        for (const k of list.keys) {
          const rec = JSON.parse((await env.KV.get(k.name))!) as DeviceRecord;
          const ep = rec.subscription?.endpoint; if (!ep || seen.has(ep)) continue; seen.add(ep);
          for (const p of plan) {
            const text = buildPushText(rec.locale ?? 'uk', p.type, { time: p.time, fecha, slot: p.slot });
            const ok = await sendPush(rec.subscription, { title: text.title, body: text.body, url: '/', focus: { fecha, slot: p.slot } }, vapid);
            sent.push({ device: k.name, type: p.type, slot: p.slot, ok });
          }
        }
        return json({ fecha, devices: list.keys.length, sent });
      }

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

      // Audit log of freed/cancelled slots (who had it, when it was noticed gone), newest first.
      // Optional filters: ?fecha=YYYYMMDD, ?slot=P1-2, ?limit=200 (default 200).
      if (url.pathname === '/api/cancel-log' && req.method === 'GET') {
        const raw = await env.KV.get('cancel-log');
        let log = raw ? (JSON.parse(raw) as CancelLogEntry[]) : [];
        const fecha = url.searchParams.get('fecha');
        const slot = url.searchParams.get('slot');
        if (fecha) log = log.filter((e) => e.fecha === fecha);
        if (slot) log = log.filter((e) => e.slot === slot);
        const limit = Number(url.searchParams.get('limit') ?? '200');
        return json({ log: log.slice(0, limit) });
      }

      // The app cancels DIRECTLY at izar4, so the client reports each successful cancel here (body = the
      // cancelled row). Dropping it from the snapshot — the cron's diff baseline — stops the next poll
      // from seeing our own cancel as a freed slot (→ a false "your booking was cancelled" push), and
      // logs it precisely in the cancel-log (source: app).
      if (url.pathname === '/api/cancelled' && req.method === 'POST') {
        const b = (await req.json().catch(() => null)) as Partial<Resv> | null;
        const id = Number(b?.id);
        if (!b || !id) return json({ ok: false }, 400);
        await recordAppCancel(env, id, b);
        return json({ ok: true });
      }

      // Client-fed snapshot: the app fetches izar4 directly (from the user's fast IP) and POSTs the
      // fresh list here so the Worker's snapshot (cron baseline + push owner-match + fast cache) stays
      // current without the Worker polling izar4 from its WAF-throttled IP. The cron still re-polls
      // independently (self-heals any bad feed within one cycle).
      if (url.pathname === '/api/snapshot' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        // Ignore empty/invalid feeds so a client glitch can't blank the snapshot (real count is never 0).
        const ok = Array.isArray(body) && body.length > 0;
        if (ok) await putSnapshot(env, body as Resv[]);
        return json({ ok });
      }

      // Reservations served from the cron-maintained KV snapshot (fast). `?live=1` forces a fresh
      // paginated fetch (used right after a booking/cancel to reconcile the read-after-write lag).
      if (url.pathname === '/api/reservas' && req.method === 'GET') {
        // Force-fresh (pull-to-refresh): fetch live now (ts = now); fall back to the last good snapshot
        // if izar4 is unavailable (a failed/partial fetch must NOT overwrite it — handled in refreshSnapshot).
        if (url.searchParams.get('live') === '1') {
          const fresh = await refreshSnapshot(env);
          if (fresh !== null) return snapshotResponse(JSON.stringify(fresh), Date.now());
          const snap = await env.KV.get('snapshot');
          return snapshotResponse(snap ?? '[]', 0);
        }
        // Normal read: serve the snapshot (kept fresh by the cron + write-patches), with its creation
        // time. We do NOT fetch izar4 here — client reads never hit the origin. Cold start only.
        const { value, metadata } = await env.KV.getWithMetadata<{ ts: number }>('snapshot');
        if (value !== null) return snapshotResponse(value, metadata?.ts ?? 0);
        const fresh = await refreshSnapshot(env);
        return snapshotResponse(JSON.stringify(fresh ?? []), Date.now());
      }

      // App writes (book/cancel) proxy to izar4, but on success we ALSO patch the KV snapshot
      // in-place so the next snapshot read reflects the change immediately — the client can then
      // refresh from the fast snapshot (~80ms) instead of a slow full live re-fetch (up to 5 pages).
      if (req.method === 'POST' && (url.pathname === '/api/wp-json/app/v1/reservar' || url.pathname === '/api/wp-json/app/v1/cancelar')) {
        const isBook = url.pathname.endsWith('/reservar');
        const reqBody = await req.text();
        const upstream = await izar4Fetch(IZAR4 + url.pathname.replace(/^\/api/, '') + url.search, {
          method: 'POST', headers: { 'content-type': req.headers.get('content-type') ?? 'application/json' }, body: reqBody,
        });
        const text = await upstream.text();
        let data: any = {}; try { data = JSON.parse(text); } catch { /* non-JSON error body */ }
        if (upstream.ok && data?.ok) await patchSnapshot(env, isBook, reqBody, data);
        return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
      }

      // default: proxy to izar4. izar4's WAF 503s on concurrent bursts, so retry on 503,
      // and short-cache static-ish GETs in KV so warm loads barely touch the origin.
      const path = url.pathname.replace(/^\/api/, '');   // e.g. "/wp-json/wp/v2/franjas"
      // Cache static-ish GETs in KV. Franjas/blocks/dwellings change ~never → 1 day; date-blocks → 5 min.
      // (Check bloqueos-fecha before bloqueos, since the former startsWith the latter's prefix.)
      let cacheTtl = 0;
      if (req.method === 'GET') {
        if (path.startsWith('/wp-json/wp/v2/bloqueos-fecha')) cacheTtl = 300;
        else if (['/wp-json/wp/v2/franjas', '/wp-json/wp/v2/bloqueos', '/wp-json/app/v1/inmuebles'].some((p) => path.startsWith(p))) cacheTtl = 86400;
      }
      const isCacheableGet = cacheTtl > 0;
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
        await env.KV.put(cacheKey, text, { expirationTtl: cacheTtl });
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
    const due = night ? minute % 10 === 0 : minute % 2 === 0;  // every 2 min by day, every 10 min at night
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

// Snapshot response carrying the snapshot's creation time (ms) so the client can show "cached at …".
function snapshotResponse(bodyText: string, ts: number): Response {
  return new Response(bodyText, { status: 200, headers: {
    'content-type': 'application/json', 'cache-control': 'no-store',
    'x-snapshot-ts': String(ts), 'access-control-expose-headers': 'x-snapshot-ts', ...CORS,
  } });
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

interface Resv { id: number; fecha: string; slot: string; vivienda: string; nombre: string }

// Paginated fetch of all padel reservations from izar4 (with retry). Used by the cron and the
// /api/reservas?live=1 endpoint; the result is stored as the KV 'snapshot' for fast reads.
// Returns `null` (NOT `[]`) when the upstream fetch fails, so callers can tell "izar4 is
// unavailable, keep the last good snapshot" apart from "there are genuinely zero reservations".
async function fetchReservasPaged(): Promise<Resv[] | null> {
  // Sequential pagination on purpose: izar4's WAF 503s on concurrent same-endpoint bursts (parallel
  // pages measured 7–11s with escalating throttling vs ~1.8s sequential). Do NOT parallelize this.
  const raw: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await izar4Fetch(`${IZAR4}/wp-json/wp/v2/reservas?per_page=100&page=${page}&recurso=${TERM}&_fields=id,acf`,
      { method: 'GET', headers: { 'content-type': 'application/json' } });
    if (res.status === 400) break;   // WordPress 'invalid page number' → past the last page; list is complete
    if (!res.ok) return null;        // real upstream failure (503/timeout) → don't return a partial/empty list
    const arr = (await res.json()) as any[];
    raw.push(...arr);
    if (arr.length < 100) break;
  }
  return raw.filter((r) => r.acf).map((r) => ({
    id: Number(r.id),
    fecha: String(r.acf.fecha_reservas).replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3$2$1'),
    slot: r.acf.id_franja_reservas,
    vivienda: r.acf.vivienda_reservas ?? '',
    nombre: r.acf.nombre_reservas ?? '',
  }));
}

// Write the snapshot with a freshness timestamp (read back via getWithMetadata for stale-while-revalidate).
async function putSnapshot(env: Env, reservas: Resv[]): Promise<void> {
  await env.KV.put('snapshot', JSON.stringify(reservas), { metadata: { ts: Date.now() } });
}

// Append to the cancel/freed-slot audit log (best-effort — a log failure must not break booking/cancel/poll).
async function logCancellations(env: Env, entries: CancelLogEntry[], now: number): Promise<void> {
  if (entries.length === 0) return;
  try {
    const raw = await env.KV.get('cancel-log');
    const existing = raw ? (JSON.parse(raw) as CancelLogEntry[]) : [];
    await env.KV.put('cancel-log', JSON.stringify(appendCancelLog(existing, entries, now)));
  } catch { /* best-effort */ }
}

// Fetch the live list and store it as the snapshot. Returns null (and leaves the snapshot untouched)
// when izar4 is unavailable, so a failure never blanks the data.
async function refreshSnapshot(env: Env): Promise<Resv[] | null> {
  const reservas = await fetchReservasPaged();
  if (reservas !== null) await putSnapshot(env, reservas);
  return reservas;
}

// Keep the KV snapshot in step with an app booking/cancel so reads reflect it without waiting for
// the cron. Best-effort: any failure just leaves the cron / live reconcile to self-correct.
// (No snapshot yet → skip; the next live read seeds it.) `slot`/`fecha` match the snapshot format
// (id_franja_reservas, YYYYMMDD) used by fetchReservasPaged.
async function patchSnapshot(env: Env, isBook: boolean, reqBody: string, resp: any): Promise<void> {
  try {
    const raw = await env.KV.get('snapshot');
    if (!raw) return;
    let snap = JSON.parse(raw) as Resv[];
    const b = JSON.parse(reqBody);
    if (isBook) {
      const fecha = String(b.fecha), slot = String(b.idFranja);
      snap = snap.filter((r) => !(r.fecha === fecha && r.slot === slot));
      snap.push({ id: Number(resp.id ?? 0), fecha, slot, vivienda: String(b.vivienda ?? '').toUpperCase(), nombre: String(b.nombre ?? '') });
    } else {
      // (Not logged here: the client reports every cancel — direct or via this proxy — to /api/cancelled.)
      const idReserva = Number(b.idReserva);
      snap = snap.filter((r) => r.id !== idReserva);
    }
    await putSnapshot(env, snap);
  } catch { /* best-effort */ }
}

// An app cancel reported via /api/cancelled: remove it from the snapshot and log it. The snapshot row
// is the authoritative owner; the client's copy covers a row that's already gone (the proxy fallback
// patched it out, or a client feed landed first). Best-effort.
async function recordAppCancel(env: Env, id: number, reported: Partial<Resv>): Promise<void> {
  try {
    const raw = await env.KV.get('snapshot');
    const snap = raw ? (JSON.parse(raw) as Resv[]) : [];
    const inSnap = snap.find((r) => r.id === id);
    if (inSnap) await putSnapshot(env, snap.filter((r) => r.id !== id));
    const row = inSnap ?? reported;
    if (!row.fecha || !row.slot) return;
    const now = Date.now();
    await logCancellations(env, [{ fecha: row.fecha, slot: row.slot, vivienda: row.vivienda ?? '', nombre: row.nombre ?? '', ts: now, source: 'app' }], now);
  } catch { /* best-effort */ }
}

async function runPoll(env: Env, now: Date): Promise<void> {
  // 1. fetch franjas (times) + reservations across the horizon. NOTE: Cloudflare Workers' fetch does
  // NOT support RequestInit.cache — passing it throws and crashed the whole cron (so pushes never
  // fired). Use izar4Fetch (503-retry) and guard the JSON parse.
  const fRes = await izar4Fetch(`${IZAR4}/wp-json/wp/v2/franjas?per_page=100&recurso=${TERM}&_fields=id,title,acf`, { method: 'GET', headers: { 'content-type': 'application/json' } });
  const franjasRaw = (fRes.ok ? await fRes.json().catch(() => []) : []) as any[];
  const franjas: FranjaMap = {};
  for (const f of franjasRaw) franjas[f.title?.rendered ?? ''] = { start: (f.acf?.hora_inicio_franjas ?? '00:00').slice(0, 5) };

  const reservas = await fetchReservasPaged();
  if (reservas === null) return;   // izar4 unavailable this cycle → keep the last good snapshot, skip the diff
  const occupied = reservas.map((r) => `${r.fecha}|${r.slot}`);

  // 2. diff vs snapshot (snapshot stores full reservas with owners)
  const prevRaw = await env.KV.get('snapshot');
  const prev: { fecha: string; slot: string; vivienda: string; nombre: string }[] = prevRaw ? JSON.parse(prevRaw) : [];
  const prevKeys = prev.map((r) => `${r.fecha}|${r.slot}`);
  const prevByKey = new Map(prev.map((r) => [`${r.fecha}|${r.slot}`, r]));
  const { freed } = diffSnapshots(prevKeys, occupied);
  await putSnapshot(env, reservas);
  if (prev.length === 0) return; // first run: just seed the snapshot, no notifications

  // Audit log: every freed slot noticed this cycle, regardless of the 7-day notification window.
  // App-driven cancels are already logged (precisely) by /api/cancelled and won't reappear here,
  // since it removes them from this same 'snapshot' baseline before the next poll runs.
  const cancelEntries = freed.map((key): CancelLogEntry | null => {
    const o = prevByKey.get(key);
    if (!o) return null;
    const [fecha, slot] = key.split('|');
    return { fecha, slot, vivienda: o.vivienda, nombre: o.nombre, ts: now.getTime(), source: 'poll' };
  }).filter((e): e is CancelLogEntry => e !== null);
  await logCancellations(env, cancelEntries, now.getTime());

  const todayYmd = dateToYmd(now);
  const weekFreed = freed.filter((k) => { const d = k.split('|')[0]; return d >= todayYmd && d <= addDaysYmd(todayYmd, 7); });

  // 3. per device
  const list = await env.KV.list({ prefix: 'device:' });
  const vapid: Vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE };

  // Dedup by push-subscription endpoint: a re-subscribe (e.g. after the baked device-secret changed)
  // can leave two device records for the SAME physical device, which would double every push.
  const seenEndpoints = new Set<string>();
  const autoCancelled: Resv[] = [];   // old bookings cancelled by overwrite swaps this cycle

  for (const k of list.keys) {
    const rec = JSON.parse((await env.KV.get(k.name))!) as DeviceRecord;
    if (!rec.prefs?.master) continue;
    const endpoint = rec.subscription?.endpoint;
    if (endpoint) { if (seenEndpoints.has(endpoint)) continue; seenEndpoints.add(endpoint); }
    const deviceId = k.name.slice('device:'.length);
    let changed = false;
    const grabbedOut: any[] = [];

    // 3a. auto-grab on active watches
    for (const watch of rec.watches.filter((w) => w.active)) {
      if (isWatchExpired(watch, franjas, now)) { watch.active = false; changed = true;
        await maybePush(rec, 'watchExpired', { fecha: watch.fecha }, vapid, now); continue; }
      const myV = rec.profile.vivienda.trim().toUpperCase();
      const sameDay = reservas.filter((r) => r.vivienda.trim().toUpperCase() === myV && r.fecha === watch.fecha);
      const weekCount = countWeekKeys(reservas, rec.profile.vivienda, watch.fecha);
      const dayCount = sameDay.length;
      // overwrite watch + an existing same-day booking → the swap (book new, cancel old) is limit-neutral.
      const bypassLimits = !!watch.overwrite && dayCount >= 1;
      const slot = chooseGrab(watch, freed, { franjas, now, weekCount, dayCount, weeklyLimit: 3, dailyLimit: 1, bypassLimits });
      if (!slot) {
        // Nothing grabbable this cycle (nothing freed, or at the weekly/daily limit and not an overwrite
        // swap). Keep the watch ACTIVE — it's a standing intent for a fixed date: if you free room before
        // that date it grabs next cycle. It self-clears only on grab or date expiry.
        continue;
      }
      const ok = await createReservation(rec.profile, watch.fecha, slot);
      if (ok.ok) {
        watch.active = false; changed = true;
        // Overwrite: the new slot is now secured — cancel the same-day booking(s) so we don't exceed 1/day.
        // Book-before-cancel guarantees we're never left without a booking. Best-effort with the profile
        // code; if it doesn't match, the client reconciles on pull (see syncGrabbed).
        let old: Resv | null = null; let oldCancelled = false;
        if (watch.overwrite) {
          for (const b of sameDay) {
            if (b.slot === slot) continue;
            if (!old) old = b;
            const done = await cancelReservation(b.id, rec.profile.codigo);
            if (done) autoCancelled.push(b);
            if (b === old) oldCancelled = done;
          }
        }
        grabbedOut.push({ fecha: watch.fecha, slot, id: ok.id, codigo: rec.profile.codigo, start: franjas[slot]?.start ?? '',
          overwrite: !!watch.overwrite, oldId: old?.id, oldSlot: old?.slot, oldCancelled });
        await maybePush(rec, 'grabbed', { time: franjas[slot]?.start ?? '', fecha: watch.fecha, slot }, vapid, now);
      }
    }

    // 3b. generic freed-slot notifications (next 7 days), excluding auto-grabbed-by-this-device
    if (rec.prefs.types.freed) {
      const myV = rec.profile.vivienda.trim().toUpperCase();
      const myN = rec.profile.nombre.trim().toLowerCase();
      for (const key of weekFreed) {
        if (rec.prefs.suppressSelf && (rec.recentActions ?? []).includes(key)) continue;
        const o = prevByKey.get(key);   // your OWN cancelled booking → covered by myCancelled, don't also send generic "freed"
        if (o && o.vivienda.trim().toUpperCase() === myV && o.nombre.trim().toLowerCase() === myN) continue;
        const [fecha, slot] = key.split('|');
        if (grabbedOut.some((g) => g.fecha === fecha && g.slot === slot)) continue;
        await maybePush(rec, 'freed', { time: franjas[slot]?.start ?? '', fecha, slot }, vapid, now);
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
        await maybePush(rec, 'myCancelled', { time: franjas[slot]?.start ?? '', fecha, slot }, vapid, now);
      }
    }

    if (grabbedOut.length) {
      const existingRaw = await env.KV.get(`grabbed:${deviceId}`);
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      await env.KV.put(`grabbed:${deviceId}`, JSON.stringify([...existing, ...grabbedOut]));
    }
    if (changed) await env.KV.put(k.name, JSON.stringify(rec));
  }

  // The baseline above was written before the overwrite swaps cancelled those old bookings. Drop them
  // now, or the next poll would see them as freed and push a false "your booking was cancelled".
  if (autoCancelled.length) {
    const ids = new Set(autoCancelled.map((r) => r.id));
    await putSnapshot(env, reservas.filter((r) => !ids.has(r.id)));
    await logCancellations(env, autoCancelled.map((r) => ({ fecha: r.fecha, slot: r.slot, vivienda: r.vivienda, nombre: r.nombre, ts: now.getTime(), source: 'auto' as const })), now.getTime());
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
  // Slot-specific pushes (freed/grabbed/myCancelled) carry the target so tapping the notification deep-links
  // to that date and blinks the slot (same highlight as tapping a row in "My bookings"). watchExpired has no slot.
  const focus = params.fecha && params.slot ? { fecha: params.fecha, slot: params.slot } : undefined;
  try { await sendPush(rec.subscription, { title: text.title, body: text.body, url: '/', focus }, vapid); }
  catch { /* a stale/expired subscription must not break the rest of the device loop */ }
}

async function createReservation(profile: { nombre: string; vivienda: string; codigo: string }, fecha: string, slot: string): Promise<{ ok: boolean; id?: number }> {
  const body = { titulo: `${fecha} - PADEL ${slot}`, idFranja: slot, fecha, nombre: profile.nombre, vivienda: profile.vivienda.toUpperCase(), codigo: profile.codigo, idTermino: TERM };
  const r = await fetch(`${IZAR4}/wp-json/app/v1/reservar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean; id?: number };
  return { ok: !!d.ok, id: d.id };
}

// Cancel a reservation (used by an overwrite grab to drop the old same-day booking after securing the
// new one). izar4's `codigo` must equal the booking's cancel code; the profile code works for
// app-created bookings. Returns false on wrong code / failure — the caller keeps the booking.
async function cancelReservation(idReserva: number, codigo: string): Promise<boolean> {
  const r = await fetch(`${IZAR4}/wp-json/app/v1/cancelar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idReserva, codigo }) });
  const d = (await r.json().catch(() => ({}))) as { ok?: boolean };
  return !!d.ok;
}

function dateToYmd(d: Date): string {
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)); d.setDate(d.getDate() + days);
  return dateToYmd(d);
}
