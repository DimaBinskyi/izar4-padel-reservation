import type { Reservation } from './types';
import { ymdToDate, dateToYmd } from './dates';

export function weekRange(fechaYmd: string): { monday: string; sunday: string } {
  const d = ymdToDate(fechaYmd);
  const dow = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday: dateToYmd(monday), sunday: dateToYmd(sunday) };
}

function sameViv(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

export function countWeek(all: Reservation[], vivienda: string, fechaYmd: string): number {
  const { monday, sunday } = weekRange(fechaYmd);
  return all.filter((r) => sameViv(r.vivienda, vivienda) && r.fecha >= monday && r.fecha <= sunday).length;
}

export function countDay(all: Reservation[], vivienda: string, fechaYmd: string): number {
  return all.filter((r) => sameViv(r.vivienda, vivienda) && r.fecha === fechaYmd).length;
}

export function weeklyRemaining(all: Reservation[], vivienda: string, fechaYmd: string, limit: number): number {
  return Math.max(0, limit - countWeek(all, vivienda, fechaYmd));
}
