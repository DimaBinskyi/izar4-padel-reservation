const KEY = 'padel_device_secret';

export function getDeviceSecret(): string {
  // For a personal deploy, build with VITE_DEVICE_SECRET set to the Worker's DEVICE_SECRET so
  // the x-device-secret header matches automatically (no manual localStorage step on the phone).
  const fromEnv = import.meta.env.VITE_DEVICE_SECRET as string | undefined;
  if (fromEnv) return fromEnv;
  let s = localStorage.getItem(KEY);
  if (!s) {
    s = crypto.randomUUID();
    localStorage.setItem(KEY, s);
  }
  return s;
}
