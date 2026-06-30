import { describe, it, expect, beforeEach } from 'vitest';
import { markCalendarAdded, hasCalendarEvent, clearCalendarEvent, pruneCalendarEvents } from './calendarEvents';

beforeEach(() => localStorage.clear());

describe('calendarEvents', () => {
  it('mark then has', () => {
    expect(hasCalendarEvent('20260703|P1-1')).toBe(false);
    markCalendarAdded('20260703|P1-1');
    expect(hasCalendarEvent('20260703|P1-1')).toBe(true);
  });

  it('mark is idempotent (no duplicate keys)', () => {
    markCalendarAdded('20260703|P1-1');
    markCalendarAdded('20260703|P1-1');
    expect(JSON.parse(localStorage.getItem('padel_calendar_events')!)).toEqual(['20260703|P1-1']);
  });

  it('clear removes the key', () => {
    markCalendarAdded('20260703|P1-1');
    clearCalendarEvent('20260703|P1-1');
    expect(hasCalendarEvent('20260703|P1-1')).toBe(false);
  });

  it('prune drops keys whose date is before the cutoff', () => {
    markCalendarAdded('20260601|P1-1');
    markCalendarAdded('20260705|P1-2');
    pruneCalendarEvents('20260630');
    expect(hasCalendarEvent('20260601|P1-1')).toBe(false);
    expect(hasCalendarEvent('20260705|P1-2')).toBe(true);
  });
});
