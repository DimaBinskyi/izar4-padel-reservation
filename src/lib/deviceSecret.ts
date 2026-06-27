const KEY = 'padel_device_secret';

export function getDeviceSecret(): string {
  let s = localStorage.getItem(KEY);
  if (!s) {
    s = crypto.randomUUID();
    localStorage.setItem(KEY, s);
  }
  return s;
}
