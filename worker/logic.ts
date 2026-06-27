export interface Watch { fecha: string; franjas: string[]; active: boolean }
export interface FranjaTime { start: string }
export type FranjaMap = Record<string, FranjaTime>;

export function diffSnapshots(prev: string[], curr: string[]): { freed: string[]; added: string[] } {
  const prevSet = new Set(prev);
  const currSet = new Set(curr);
  return {
    freed: prev.filter((k) => !currSet.has(k)),
    added: curr.filter((k) => !prevSet.has(k)),
  };
}

function ymdToParts(ymd: string) {
  return { y: +ymd.slice(0, 4), m: +ymd.slice(4, 6), d: +ymd.slice(6, 8) };
}
function toMidnight(ymd: string): number {
  const { y, m, d } = ymdToParts(ymd);
  return new Date(y, m - 1, d).getTime();
}
function startMinutes(hhmm: string): number {
  const [h, mi] = hhmm.split(':').map(Number);
  return h * 60 + mi;
}

export function slotStartPassed(fecha: string, slot: string, franjas: FranjaMap, now: Date): boolean {
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMid = toMidnight(fecha);
  if (dayMid < todayMid) return true;            // past day
  if (dayMid > todayMid) return false;           // future day
  const f = franjas[slot];
  if (!f) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= startMinutes(f.start);        // today: passed if start <= now
}

function dateToYmd(d: Date): string {
  return d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

export function weekRange(fechaYmd: string): { monday: string; sunday: string } {
  const { y, m, d } = ymdToParts(fechaYmd);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const monday = new Date(date); monday.setDate(date.getDate() - (dow === 0 ? 6 : dow - 1));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { monday: dateToYmd(monday), sunday: dateToYmd(sunday) };
}

export function countWeekKeys(
  reservas: { fecha: string; vivienda: string }[], vivienda: string, fechaYmd: string,
): number {
  const { monday, sunday } = weekRange(fechaYmd);
  const v = vivienda.trim().toUpperCase();
  return reservas.filter((r) => r.vivienda.trim().toUpperCase() === v && r.fecha >= monday && r.fecha <= sunday).length;
}

export interface GrabCtx {
  franjas: FranjaMap; now: Date;
  weekCount: number; dayCount: number; weeklyLimit: number; dailyLimit: number;
}

export function chooseGrab(watch: Watch, freedKeys: string[], ctx: GrabCtx): string | null {
  if (!watch.active) return null;
  if (ctx.dayCount >= ctx.dailyLimit) return null;
  if (ctx.weekCount >= ctx.weeklyLimit) return null;
  const freedSet = new Set(freedKeys);
  for (const slot of watch.franjas) {
    const key = `${watch.fecha}|${slot}`;
    if (!freedSet.has(key)) continue;
    if (slotStartPassed(watch.fecha, slot, ctx.franjas, ctx.now)) continue;
    return slot;
  }
  return null;
}

export function isWatchExpired(watch: Watch, franjas: FranjaMap, now: Date): boolean {
  return watch.franjas.every((slot) => slotStartPassed(watch.fecha, slot, franjas, now));
}
