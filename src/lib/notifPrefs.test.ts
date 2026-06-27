import { describe, it, expect, beforeEach } from 'vitest';
import { loadPrefs, savePrefs, defaultPrefs, isQuietNow, type NotifPrefs } from './notifPrefs';

beforeEach(() => localStorage.clear());

describe('notifPrefs', () => {
  it('defaults: master on, all types on, self-suppress on, quiet off', () => {
    const p = defaultPrefs();
    expect(p.master).toBe(true);
    expect(p.types.freed && p.types.grabbed && p.types.limitOff && p.types.watchExpired && p.types.myCancelled).toBe(true);
    expect(p.suppressSelf).toBe(true);
    expect(p.quiet.enabled).toBe(false);
  });

  it('saves and loads', () => {
    const p = defaultPrefs(); p.types.freed = false;
    savePrefs(p);
    expect(loadPrefs().types.freed).toBe(false);
  });

  it('isQuietNow respects an enabled window 00:00–07:00', () => {
    const p = defaultPrefs(); p.quiet = { enabled: true, from: '00:00', to: '07:00', nightAllowed: { grabbed: true, freed: false, limitOff: false, watchExpired: false, myCancelled: false } };
    expect(isQuietNow(p, new Date(2026, 5, 28, 3, 0))).toBe(true);   // 03:00 inside
    expect(isQuietNow(p, new Date(2026, 5, 28, 9, 0))).toBe(false);  // 09:00 outside
  });
});
