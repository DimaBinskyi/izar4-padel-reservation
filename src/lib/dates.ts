const WEEKDAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']; // Sun..Sat (izar4 codes)

export function ymdToDate(ymd: string): Date {
  return new Date(
    parseInt(ymd.slice(0, 4), 10),
    parseInt(ymd.slice(4, 6), 10) - 1,
    parseInt(ymd.slice(6, 8), 10),
  );
}

export function dateToYmd(d: Date): string {
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

export function normalizeYmd(s: string): string {
  if (/^\d{8}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}${m[2]}${m[1]}`;
  return s;
}

// YYYYMMDD → "DD.MM.YYYY" for display. Leaves anything not 8 digits untouched.
export function ymdToDisplay(ymd: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(ymd);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd;
}

export function weekdayCode(ymd: string): string {
  return WEEKDAYS[ymdToDate(ymd).getDay()];
}

export function addDays(ymd: string, days: number): string {
  const d = ymdToDate(ymd);
  d.setDate(d.getDate() + days);
  return dateToYmd(d);
}

function atMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function isTodayYmd(ymd: string, today: Date): boolean {
  return atMidnight(ymdToDate(ymd)) === atMidnight(today);
}

export function isPastYmd(ymd: string, today: Date): boolean {
  return atMidnight(ymdToDate(ymd)) < atMidnight(today);
}
