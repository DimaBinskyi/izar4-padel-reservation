// Per-device record of which bookings the user created a phone-calendar event for.
// Keyed by `${fecha}|${slot}` (same key as bookingsDb). Used to (a) confirm before adding a
// duplicate and (b) remind the user to delete the orphaned event when they cancel.
const KEY = 'padel_calendar_events';

function load(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function save(keys: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(keys));
}

export function markCalendarAdded(key: string): void {
  const list = load();
  if (!list.includes(key)) {
    list.push(key);
    save(list);
  }
}

export function hasCalendarEvent(key: string): boolean {
  return load().includes(key);
}

export function clearCalendarEvent(key: string): void {
  save(load().filter((k) => k !== key));
}

// Drop keys whose game date (the `fecha` part of the key) is before `beforeYmd`.
export function pruneCalendarEvents(beforeYmd: string): void {
  save(load().filter((k) => k.split('|')[0] >= beforeYmd));
}
