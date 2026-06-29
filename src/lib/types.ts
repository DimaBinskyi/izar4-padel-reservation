export interface Franja {
  id: number;
  slot: string;        // e.g. "P1-1" (the franja title; used in reservations)
  start: string;       // "HH:MM"
  end: string;         // "HH:MM"
  order: number;
}

export interface Reservation {
  id: number;
  slot: string;        // id_franja_reservas, e.g. "P1-2"
  fecha: string;       // YYYYMMDD
  nombre: string;
  vivienda: string;
  // codigo_cancelacion is intentionally NOT modeled here in Phase 1 (read-only, not displayed).
}

export interface DayBlock { motivo: string; }          // whole-day closure
export type WeekdayBlockSet = Record<string, true>;     // key: `${slot}_${weekdayCode}`

export type SlotStatus = 'libre' | 'ocupado' | 'bloqueado' | 'pasado' | 'pronto';

export interface SlotView {
  franja: Franja;
  status: SlotStatus;
  reservation: Reservation | null;   // present when ocupado
  past: boolean;                     // slot's start time has elapsed (no actions: no book/watch/cancel)
}
