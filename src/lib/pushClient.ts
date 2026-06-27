import { urlBase64ToUint8Array } from './push';
import { getDeviceSecret } from './deviceSecret';
import { WORKER_BASE } from '../config';
import { loadProfile } from './profile';
import { loadWatches } from './watchlist';
import { loadPrefs } from './notifPrefs';
import { recentActionKeys } from './recentActions';
import i18n from '../i18n';

function deviceId(): string { return getDeviceSecret(); }

async function getVapidPublic(): Promise<string> {
  const r = await fetch(`${WORKER_BASE}/api/vapid`, { headers: { 'x-device-secret': getDeviceSecret() } });
  const d = (await r.json()) as { publicKey: string };
  return d.publicKey;
}

export async function enablePush(): Promise<boolean> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const pub = await getVapidPublic();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pub).buffer as ArrayBuffer });
  await syncRegistration(sub);
  return true;
}

export async function syncRegistration(sub?: PushSubscription): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const subscription = sub ?? (await reg.pushManager.getSubscription());
  const profile = loadProfile();
  if (!subscription || !profile) return;
  await fetch(`${WORKER_BASE}/api/subscribe?device=${encodeURIComponent(deviceId())}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-secret': getDeviceSecret() },
    body: JSON.stringify({ subscription: subscription.toJSON(), profile, watches: loadWatches(), prefs: loadPrefs(), locale: i18n.language, recentActions: recentActionKeys() }),
  });
}
