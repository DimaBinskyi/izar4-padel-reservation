// Static facts about the izar4 padel resource (see docs/API.md).
export const API_BASE = '/api/wp-json';        // proxied through the Worker
export const APP_API_BASE = '/api/wp-json/app/v1';
export const PADEL_SLUG = 'padel';
export const PADEL_TERM_ID = 12;               // taxonomy term id for filtering
export const BOOKING_HORIZON_DAYS = 21;        // how far ahead a slot can be booked
export const CALENDAR_DAYS = 31;               // how many days the strip shows (min = today)
export const NOTIFY_WINDOW_DAYS = 7;           // generic "slot freed" window (used in Phase 3)
export const WEEKLY_LIMIT = 3;                 // per vivienda (enforced by us)
export const DAILY_LIMIT = 1;                  // per vivienda
export const APP_VERSION = '1.0.0';
