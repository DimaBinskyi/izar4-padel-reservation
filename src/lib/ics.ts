// Build an iCalendar (.ics) event for a padel booking and hand it to the OS calendar.
// A PWA cannot write the device calendar via any API; an .ics with a VALARM is the only
// cross-platform way to create an event with a custom reminder.

export interface CalEvent {
  title: string;
  fecha: string; // YYYYMMDD
  start: string; // HH:MM
  end: string; // HH:MM
  location: string;
  description: string;
  uid: string;
}

// Escape TEXT values per RFC 5545: backslash, semicolon, comma, and newlines.
function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// "HH:MM" -> "HHMMSS" (basic iCalendar local time). Accepts only the "HH:MM" shape.
function hhmmToIcal(t: string): string {
  return t.slice(0, 2) + t.slice(3, 5) + '00';
}

// Current UTC timestamp as iCalendar "YYYYMMDDTHHMMSSZ" (required as DTSTAMP on a VEVENT).
function nowStampUtc(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Assemble a CalEvent from a booking's primitives plus already-localized labels.
export function buildBookingEvent(
  b: { fecha: string; slot: string; start: string; end: string },
  labels: { title: string; location: string; description: string },
): CalEvent {
  return {
    title: labels.title,
    fecha: b.fecha,
    start: b.start,
    end: b.end,
    location: labels.location,
    description: labels.description,
    uid: `${b.fecha}-${b.slot}@izar4-padel`,
  };
}

export function buildIcs(ev: CalEvent): string {
  // Floating local time (no TZID): the calendar interprets it in the device's timezone,
  // which matches the local Spanish slot times.
  const dtStart = `${ev.fecha}T${hhmmToIcal(ev.start)}`;
  const dtEnd = `${ev.fecha}T${hhmmToIcal(ev.end)}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//izar4-padel//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${nowStampUtc()}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(ev.title)}`,
    `LOCATION:${esc(ev.location)}`,
    `DESCRIPTION:${esc(ev.description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(ev.title)}`,
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

// iOS (Safari or standalone PWA) ignores the <a download> attribute; opening the blob URL
// makes iOS show its native "Add to Calendar" sheet. Android/desktop honor the download.
// Heuristic: navigator.platform is deprecated and can report 'MacIntel' on Apple Silicon, so
// we also require touch points to tell iPadOS apart from a desktop Mac. Good enough here.
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /ipad|iphone|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Side effect: trigger the OS "add to calendar" flow. Not unit-tested (DOM/navigator).
export function downloadIcs(ev: CalEvent): void {
  const blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  if (isIos()) {
    window.location.assign(url);
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = `padel-${ev.fecha}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
