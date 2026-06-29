const KEY = 'padel_device_secret';
const ID_KEY = 'padel_device_id';

// Per-INSTALL unique id, used as the device RECORD key on the Worker (push subscription/profile/
// watches/prefs live under `device:<id>`). Must be distinct from the shared auth secret below —
// otherwise every user/install shares ONE record and clobbers each other's subscription & watches.
export function getDeviceId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(ID_KEY, id); }
  return id;
}

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
