import type { Franja } from './types';
import { dateToYmd } from './dates';

export interface Watch { id?: string; fecha: string; franjas: string[]; active: boolean; overwrite?: boolean }

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

export type AddResult = { status: 'added' | 'merged' | 'already' | 'upgraded'; count: number; overwrite: boolean };

// Is `slots` contiguous (overlapping or adjacent) with an existing OVERWRITE watch on `fecha`?
// The create form uses this to force-lock the overwrite checkbox: saving would merge into that
// overwrite watch and inherit its flag, so the choice is already made.
export function wouldMergeOverwrite(fecha: string, slots: string[], ordered: string[]): boolean {
  if (slots.length === 0) return false;
  const set = new Set(slots);
  return loadWatches().some((w) => w.fecha === fecha && w.overwrite && unionContiguous(set, w.franjas, ordered));
}

// Add a watch for `fecha` covering `slots`. It MERGES into any same-date watch it overlaps or touches
// (contiguous, no gap); disjoint ranges on the same day (e.g. morning vs evening) stay SEPARATE watches.
// `overwrite` allows the grab to overwrite an existing same-day booking. On merge the flag is OR-ed
// across all merged parts (overwrite always wins), so a plain watch adjacent to an overwrite one
// becomes overwrite, and vice versa.
export function addOrMergeWatch(fecha: string, slots: string[], ordered: string[], overwrite = false): AddResult {
  if (slots.length === 0) return { status: 'already', count: 0, overwrite };
  const all = loadWatches();
  const sameDate = all.filter((w) => w.fecha === fecha);

  // Already fully covered by one existing watch. Still upgrade it to overwrite if the user now asks for it.
  const cover = sameDate.find((w) => { const ws = new Set(w.franjas); return slots.every((s) => ws.has(s)); });
  if (cover) {
    if (overwrite && !cover.overwrite) { cover.overwrite = true; saveWatches(all); return { status: 'upgraded', count: cover.franjas.length, overwrite: true }; }
    return { status: 'already', count: cover.franjas.length, overwrite: !!cover.overwrite };
  }

  // Absorb every same-date watch that is contiguous with the growing set; keep disjoint ones separate.
  const others = all.filter((w) => w.fecha !== fecha);
  const merged = new Set(slots);
  let remaining = [...sameDate];
  let mergedAny = false, changed = true, mergedOverwrite = overwrite;
  while (changed) {
    changed = false;
    remaining = remaining.filter((w) => {
      if (unionContiguous(merged, w.franjas, ordered)) { w.franjas.forEach((s) => merged.add(s)); mergedOverwrite = mergedOverwrite || !!w.overwrite; mergedAny = true; changed = true; return false; }
      return true;
    });
  }
  const mergedSlots = ordered.filter((s) => merged.has(s));
  saveWatches([...others, ...remaining, { id: crypto.randomUUID(), fecha, franjas: mergedSlots, active: true, overwrite: mergedOverwrite }]);
  return { status: mergedAny ? 'merged' : 'added', count: mergedSlots.length, overwrite: mergedOverwrite };
}

// The watch (if any) that already covers `slot` on `fecha` — i.e. we're already catching this time.
// Used by the slots screen to swap the "add watch" 🎯 button for the "view watch" 👁 button.
export function watchCoveringSlot(watches: Watch[], fecha: string, slot: string): Watch | undefined {
  return watches.find((w) => w.fecha === fecha && w.franjas.includes(slot));
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
