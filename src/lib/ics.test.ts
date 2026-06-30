import { describe, it, expect } from 'vitest';
import { buildIcs, buildBookingEvent, type CalEvent } from './ics';

const ev: CalEvent = {
  title: 'Pádel 🎾',
  fecha: '20260703',
  start: '09:00',
  end: '10:00',
  location: 'IZAR 4 — Pista de pádel',
  description: 'P1-1 · 09:00–10:00 · Dmytro · P3-7',
  uid: '20260703-P1-1@izar4-padel',
};

describe('buildIcs', () => {
  const out = buildIcs(ev);

  it('wraps a VEVENT in a VCALENDAR', () => {
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).toContain('BEGIN:VEVENT');
    expect(out).toContain('END:VEVENT');
    expect(out).toContain('END:VCALENDAR');
  });

  it('derives floating local DTSTART/DTEND from fecha + HH:MM (no TZID)', () => {
    expect(out).toContain('DTSTART:20260703T090000');
    expect(out).toContain('DTEND:20260703T100000');
    expect(out).not.toContain('TZID');
  });

  it('includes a 15-minute display alarm', () => {
    expect(out).toContain('BEGIN:VALARM');
    expect(out).toContain('ACTION:DISPLAY');
    expect(out).toContain('TRIGGER:-PT15M');
  });

  it('carries the stable UID and uses CRLF line endings', () => {
    expect(out).toContain('UID:20260703-P1-1@izar4-padel');
    expect(out).toContain('\r\n');
  });

  it('escapes backslash, comma and semicolon per RFC 5545', () => {
    const e = buildIcs({ ...ev, description: 'a,b;c\\d' });
    expect(e).toContain('DESCRIPTION:a\\,b\\;c\\\\d');
  });

  it('formats a non-zero-minute time correctly', () => {
    const e = buildIcs({ ...ev, start: '20:30', end: '22:00' });
    expect(e).toContain('DTSTART:20260703T203000');
    expect(e).toContain('DTEND:20260703T220000');
  });

  it('includes a UTC DTSTAMP', () => {
    expect(out).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });
});

describe('buildBookingEvent', () => {
  it('composes the stable UID and copies labels', () => {
    const built = buildBookingEvent(
      { fecha: '20260703', slot: 'P1-1', start: '09:00', end: '10:00' },
      { title: 'Pádel 🎾', location: 'IZAR 4 — Pista de pádel', description: 'P1-1 · 09:00–10:00' },
    );
    expect(built.uid).toBe('20260703-P1-1@izar4-padel');
    expect(built.fecha).toBe('20260703');
    expect(built.start).toBe('09:00');
    expect(built.end).toBe('10:00');
    expect(built.title).toBe('Pádel 🎾');
    expect(built.location).toBe('IZAR 4 — Pista de pádel');
    expect(built.description).toBe('P1-1 · 09:00–10:00');
  });
});
