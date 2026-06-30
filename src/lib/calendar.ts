import { downloadIcs, type CalEvent } from './ics';
import { hasCalendarEvent, markCalendarAdded } from './calendarEvents';

// Add a booking's event to the phone calendar. If an event was already created for this booking,
// ask the caller's confirm() first (an .ics always creates a NEW event → avoid silent duplicates).
// Returns true when the .ics was triggered, false when the user declined the duplicate prompt.
export function addBookingToCalendar(ev: CalEvent, key: string, confirmDuplicate: () => boolean): boolean {
  if (hasCalendarEvent(key) && !confirmDuplicate()) return false;
  downloadIcs(ev);
  markCalendarAdded(key);
  return true;
}
