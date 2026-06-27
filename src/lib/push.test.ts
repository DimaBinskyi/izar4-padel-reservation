import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array, permissionState } from './push';

describe('push helpers', () => {
  it('urlBase64ToUint8Array decodes a VAPID key to the right length', () => {
    // A 65-byte P-256 public key is base64url ~88 chars. Use a known short value.
    const out = urlBase64ToUint8Array('AAAA'); // 3 bytes of zero
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(3);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it('permissionState maps Notification.permission + standalone', () => {
    expect(permissionState({ supported: false, standalone: false, permission: 'default' })).toBe('unsupported');
    expect(permissionState({ supported: true, standalone: false, permission: 'default' })).toBe('not-installed');
    expect(permissionState({ supported: true, standalone: true, permission: 'default' })).toBe('prompt');
    expect(permissionState({ supported: true, standalone: true, permission: 'granted' })).toBe('granted');
    expect(permissionState({ supported: true, standalone: true, permission: 'denied' })).toBe('denied');
  });
});
