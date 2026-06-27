export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PermState = 'unsupported' | 'not-installed' | 'prompt' | 'granted' | 'denied';

export function permissionState(env: {
  supported: boolean; standalone: boolean; permission: NotificationPermission;
}): PermState {
  if (!env.supported) return 'unsupported';
  if (!env.standalone) return 'not-installed';
  if (env.permission === 'granted') return 'granted';
  if (env.permission === 'denied') return 'denied';
  return 'prompt';
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function currentPermState(): PermState {
  return permissionState({
    supported: pushSupported(),
    standalone: isStandalone(),
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
  });
}
