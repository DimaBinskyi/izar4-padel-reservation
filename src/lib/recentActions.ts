interface Action { key: string; ts: number }
const KEY = 'padel_recent_actions';
const WINDOW_MS = 20 * 60 * 1000;
function load(): Action[] { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Action[]; } catch { return []; } }
export function addRecentAction(fecha: string, slot: string): void {
  const now = Date.now();
  const list = load().filter((a) => now - a.ts < WINDOW_MS);
  list.push({ key: `${fecha}|${slot}`, ts: now });
  localStorage.setItem(KEY, JSON.stringify(list));
}
export function recentActionKeys(): string[] {
  const now = Date.now();
  return load().filter((a) => now - a.ts < WINDOW_MS).map((a) => a.key);
}
