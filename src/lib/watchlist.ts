import type { Franja } from './types';
import { dateToYmd } from './dates';

export interface Watch { id?: string; fecha: string; franjas: string[]; active: boolean }

const KEY = 'padel_watchlist';

export function expandRange(franjas: Franja[], from: string, to: string): string[] {
  const sorted = [...franjas].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((f) => f.slot === from);
  const j = sorted.findIndex((f) => f.slot === to);
  if (i === -1 || j === -1) return [];
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  return sorted.slice(lo, hi + 1).map((f) => f.slot);
}

export function loadWatches(): Watch[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const ws = JSON.parse(raw) as Watch[];
    let dirty = false;
    for (const w of ws) if (!w.id) { w.id = crypto.randomUUID(); dirty = true; }   // backfill ids for old data
    if (dirty) saveWatches(ws);
    return ws;
  } catch { return []; }
}

export function saveWatches(w: Watch[]): void { localStorage.setItem(KEY, JSON.stringify(w)); }

// Low-level: replace any same-date watches with this one. (Kept for compatibility/tests; the UI uses
// addOrMergeWatch, which allows several disjoint watches per day.)
export function addWatch(w: Watch): void {
  const all = loadWatches().filter((x) => x.fecha !== w.fecha);
  all.push({ ...w, id: w.id ?? crypto.randomUUID() });
  saveWatches(all);
}

// Are the two slot sets contiguous in the ordered slot list (overlapping or adjacent — no gap)?
function unionContiguous(a: Set<string>, b: string[], ordered: string[]): boolean {
  const set = new Set(a); for (const s of b) set.add(s);
  const idx: number[] = [];
  ordered.forEach((s, i) => { if (set.has(s)) idx.push(i); });
  return idx.length > 0 && idx[idx.length - 1] - idx[0] + 1 === idx.length;
}

export type AddResult = { status: 'added' | 'merged' | 'already'; count: number };

// Add a watch for `fecha` covering `slots`. It MERGES into any same-date watch it overlaps or touches
// (contiguous, no gap); disjoint ranges on the same day (e.g. morning vs evening) stay SEPARATE watches.
export function addOrMergeWatch(fecha: string, slots: string[], ordered: string[]): AddResult {
  if (slots.length === 0) return { status: 'already', count: 0 };
  const all = loadWatches();
  const sameDate = all.filter((w) => w.fecha === fecha);

  // Already fully covered by one existing watch → nothing to do.
  const cover = sameDate.find((w) => { const ws = new Set(w.franjas); return slots.every((s) => ws.has(s)); });
  if (cover) return { status: 'already', count: cover.franjas.length };

  // Absorb every same-date watch that is contiguous with the growing set; keep disjoint ones separate.
  const others = all.filter((w) => w.fecha !== fecha);
  const merged = new Set(slots);
  let remaining = [...sameDate];
  let mergedAny = false, changed = true;
  while (changed) {
    changed = false;
    remaining = remaining.filter((w) => {
      if (unionContiguous(merged, w.franjas, ordered)) { w.franjas.forEach((s) => merged.add(s)); mergedAny = true; changed = true; return false; }
      return true;
    });
  }
  const mergedSlots = ordered.filter((s) => merged.has(s));
  saveWatches([...others, ...remaining, { id: crypto.randomUUID(), fecha, franjas: mergedSlots, active: true }]);
  return { status: mergedAny ? 'merged' : 'added', count: mergedSlots.length };
}

export function removeWatch(fecha: string): void { saveWatches(loadWatches().filter((w) => w.fecha !== fecha)); }            // all watches of a date
export function removeWatchById(id: string): void { saveWatches(loadWatches().filter((w) => w.id !== id)); }                 // one watch (UI 🗑)
export function removeWatchBySlot(fecha: string, slot: string): void {                                                       // the watch that covered a grabbed slot
  saveWatches(loadWatches().filter((w) => !(w.fecha === fecha && w.franjas.includes(slot))));
}

// Drop watches whose date has already passed (they can never grab again). Called on app start and
// when the watch sheet opens, so expired watches clear themselves and the next sync drops them server-side.
export function pruneExpiredWatches(): Watch[] {
  const today = dateToYmd(new Date());
  const all = loadWatches();
  const kept = all.filter((w) => w.fecha >= today);
  if (kept.length !== all.length) saveWatches(kept);
  return kept;
}
