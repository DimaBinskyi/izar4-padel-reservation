import type { Franja } from './types';

export interface Watch { fecha: string; franjas: string[]; active: boolean }

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
  try { return JSON.parse(raw) as Watch[]; } catch { return []; }
}

export function saveWatches(w: Watch[]): void {
  localStorage.setItem(KEY, JSON.stringify(w));
}

export function addWatch(w: Watch): void {
  const all = loadWatches().filter((x) => x.fecha !== w.fecha);
  all.push(w);
  saveWatches(all);
}

export function removeWatch(fecha: string): void {
  saveWatches(loadWatches().filter((x) => x.fecha !== fecha));
}
