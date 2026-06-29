import type { Franja, Reservation, SlotView, WeekdayBlockSet } from './types';
import { weekdayCode, isPastYmd, isTodayYmd } from './dates';

export interface DeriveInput {
  fecha: string;                  // YYYYMMDD
  franjas: Franja[];
  reservations: Reservation[];    // already filtered to this date
  weekdayBlocks: WeekdayBlockSet; // key `${slot}_${weekdayCode}`
  dayBlocked: boolean;
  now: Date;
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

export function deriveSlots(input: DeriveInput): SlotView[] {
  const { fecha, franjas, reservations, weekdayBlocks, dayBlocked, now } = input;
  const wd = weekdayCode(fecha);
  const byNum = [...franjas].sort((a, b) => a.order - b.order);
  const resBySlot = new Map(reservations.map((r) => [r.slot, r]));
  const past = isPastYmd(fecha, now);
  const today = isTodayYmd(fecha, now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return byNum.map((franja): SlotView => {
    const reservation = resBySlot.get(franja.slot) ?? null;
    // The slot's start time has elapsed (whole past date, or today and we're past its start). This is
    // independent of status — an occupied slot in the past is still `ocupado` but allows no actions.
    const elapsed = past || (today && nowMin >= minutes(franja.start));
    if (dayBlocked || weekdayBlocks[`${franja.slot}_${wd}`]) {
      return { franja, status: 'bloqueado', reservation: null, past: elapsed };
    }
    if (reservation) return { franja, status: 'ocupado', reservation, past: elapsed };
    // free slot
    if (elapsed) return { franja, status: 'pasado', reservation: null, past: true };
    return { franja, status: 'libre', reservation: null, past: false };
  });
}
