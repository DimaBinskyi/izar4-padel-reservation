export type NotifType = 'freed' | 'grabbed' | 'limitOff' | 'watchExpired' | 'myCancelled';

export interface NotifPrefs {
  master: boolean;
  types: Record<NotifType, boolean>;
  suppressSelf: boolean;
  quiet: { enabled: boolean; from: string; to: string; nightAllowed: Record<NotifType, boolean> };
}

const KEY = 'padel_notif_prefs';

export function defaultPrefs(): NotifPrefs {
  return {
    master: true,
    types: { freed: true, grabbed: true, limitOff: true, watchExpired: true, myCancelled: true },
    suppressSelf: true,
    quiet: { enabled: false, from: '00:00', to: '07:00',
      nightAllowed: { freed: false, grabbed: true, limitOff: false, watchExpired: false, myCancelled: false } },
  };
}

export function loadPrefs(): NotifPrefs {
  const raw = localStorage.getItem(KEY);
  if (!raw) return defaultPrefs();
  try { return { ...defaultPrefs(), ...JSON.parse(raw) } as NotifPrefs; } catch { return defaultPrefs(); }
}

export function savePrefs(p: NotifPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

function toMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

export function isQuietNow(p: NotifPrefs, now: Date): boolean {
  if (!p.quiet.enabled) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = toMin(p.quiet.from); const to = toMin(p.quiet.to);
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to; // handles wrap past midnight
}
