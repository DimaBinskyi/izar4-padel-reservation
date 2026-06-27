import type { BookingRecord } from './bookingsDb';
import { weekRange } from './limits';

export type Period = 'week' | 'month' | 'all' | 'custom';

export interface DateRange { from: string; to: string }

export function periodRange(period: Period, todayYmd: string, custom?: DateRange): DateRange {
  if (period === 'all') return { from: '00000000', to: '99999999' };
  if (period === 'custom' && custom) return custom;
  if (period === 'week') {
    const w = weekRange(todayYmd);
    return { from: w.monday, to: w.sunday };
  }
  // month
  const y = todayYmd.slice(0, 4);
  const m = todayYmd.slice(4, 6);
  const last = new Date(parseInt(y, 10), parseInt(m, 10), 0).getDate();
  return { from: `${y}${m}01`, to: `${y}${m}${String(last).padStart(2, '0')}` };
}

export interface StatsResult {
  total: number; played: number; cancelled: number; upcoming: number;
  autoGrabbed: number; hours: number; favouriteSlot: string | null;
}

function durationH(start: string, end: string): number {
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  return Math.max(0, (toMin(end) - toMin(start)) / 60);
}

export function aggregate(records: BookingRecord[], range: DateRange, todayYmd: string): StatsResult {
  const inRange = records.filter((r) => r.fecha >= range.from && r.fecha <= range.to);
  const active = inRange.filter((r) => r.status === 'active');
  const counts: Record<string, number> = {};
  for (const r of active) counts[r.slot] = (counts[r.slot] ?? 0) + 1;
  let favouriteSlot: string | null = null;
  let best = 0;
  for (const [slot, n] of Object.entries(counts)) if (n > best) { best = n; favouriteSlot = slot; }
  return {
    total: inRange.length,
    cancelled: inRange.filter((r) => r.status === 'cancelled').length,
    played: active.filter((r) => r.fecha < todayYmd).length,
    upcoming: active.filter((r) => r.fecha >= todayYmd).length,
    autoGrabbed: active.filter((r) => r.origin === 'auto').length,
    hours: active.reduce((sum, r) => sum + durationH(r.start, r.end), 0),
    favouriteSlot,
  };
}
