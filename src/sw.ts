/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: { url: string; revision: string | null }[] };

precacheAndRoute(self.__WB_MANIFEST);

type Focus = { fecha: string; slot: string };
type PushData = { title?: string; body?: string; url?: string; focus?: Focus | null };

self.addEventListener('push', (event: PushEvent) => {
  let data: PushData = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* ignore */ }
  const title = data.title ?? 'Pádel';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/', focus: data.focus ?? null },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const d = (event.notification.data ?? {}) as { url?: string; focus?: Focus | null };
  const focus = d.focus ?? null;
  // Slot-specific pushes deep-link to the date + slot so the app can blink it; others just open the app.
  const target = focus
    ? `/?fecha=${encodeURIComponent(focus.fecha)}&slot=${encodeURIComponent(focus.slot)}`
    : (d.url ?? '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          // App already open: tell it to jump+blink (a focus() alone won't change the SPA route).
          if (focus) c.postMessage({ type: 'padel-focus-slot', fecha: focus.fecha, slot: focus.slot });
          return void (c as WindowClient).focus();
        }
      }
      return self.clients.openWindow(target);   // cold start: App parses ?fecha&slot on mount
    }),
  );
});
