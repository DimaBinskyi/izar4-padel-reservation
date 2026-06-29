import { describe, it, expect, beforeEach } from 'vitest';
import { loadWatches, addWatch, removeWatch, expandRange, pruneExpiredWatches, saveWatches, addOrMergeWatch, type Watch } from './watchlist';
import type { Franja } from './types';

const franjas: Franja[] = [
  { id: 1, slot: 'P1-6', start: '16:00', end: '17:30', order: 6 },
  { id: 2, slot: 'P1-7', start: '17:30', end: '19:00', order: 7 },
  { id: 3, slot: 'P1-8', start: '19:00', end: '20:30', order: 8 },
  { id: 4, slot: 'P1-9', start: '20:30', end: '22:00', order: 9 },
];

beforeEach(() => localStorage.clear());

describe('watchlist', () => {
  it('expandRange returns the contiguous slots between from and to (inclusive, by order)', () => {
    expect(expandRange(franjas, 'P1-7', 'P1-9')).toEqual(['P1-7', 'P1-8', 'P1-9']);
    expect(expandRange(franjas, 'P1-9', 'P1-7')).toEqual(['P1-7', 'P1-8', 'P1-9']); // order-normalized
    expect(expandRange(franjas, 'P1-6', 'P1-6')).toEqual(['P1-6']);
  });

  it('add/remove/load round-trip', () => {
    const w: Watch = { fecha: '20260628', franjas: ['P1-7', 'P1-8'], active: true };
    addWatch(w);
    expect(loadWatches()).toHaveLength(1);
    removeWatch('20260628');
    expect(loadWatches()).toHaveLength(0);
  });

  it('addWatch replaces an existing watch for the same date', () => {
    addWatch({ fecha: '20260628', franjas: ['P1-7'], active: true });
    addWatch({ fecha: '20260628', franjas: ['P1-8', 'P1-9'], active: true });
    const all = loadWatches();
    expect(all).toHaveLength(1);
    expect(all[0].franjas).toEqual(['P1-8', 'P1-9']);
  });

  const ordered = franjas.map((f) => f.slot);   // P1-6, P1-7, P1-8, P1-9

  it('addOrMergeWatch merges overlapping/adjacent ranges into one watch', () => {
    expect(addOrMergeWatch('20990101', ['P1-6', 'P1-7'], ordered).status).toBe('added');
    expect(addOrMergeWatch('20990101', ['P1-7', 'P1-8'], ordered).status).toBe('merged');
    const all = loadWatches();
    expect(all).toHaveLength(1);
    expect(all[0].franjas).toEqual(['P1-6', 'P1-7', 'P1-8']);
  });

  it('addOrMergeWatch keeps disjoint same-day ranges as separate watches', () => {
    addOrMergeWatch('20990101', ['P1-6'], ordered);
    expect(addOrMergeWatch('20990101', ['P1-9'], ordered).status).toBe('added');   // gap between → separate
    expect(loadWatches()).toHaveLength(2);
  });

  it('addOrMergeWatch returns "already" when the slots are already covered', () => {
    addOrMergeWatch('20990101', ['P1-6', 'P1-7', 'P1-8'], ordered);
    const r = addOrMergeWatch('20990101', ['P1-7'], ordered);
    expect(r.status).toBe('already');
    expect(loadWatches()).toHaveLength(1);
    expect(loadWatches()[0].franjas).toEqual(['P1-6', 'P1-7', 'P1-8']);
  });

  it('pruneExpiredWatches drops past-date watches and keeps future ones (incl. standing/limit-blocked)', () => {
    saveWatches([
      { fecha: '20200101', franjas: ['P1-6'], active: true },   // long past → drop
      { fecha: '20990101', franjas: ['P1-7'], active: true },   // future standing → keep
    ]);
    expect(pruneExpiredWatches().map((w) => w.fecha)).toEqual(['20990101']);
    expect(loadWatches().map((w) => w.fecha)).toEqual(['20990101']);
  });
});
