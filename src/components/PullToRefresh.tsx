import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Spinner } from './Spinner';

const THRESHOLD = 70;   // px pulled (after resistance) needed to trigger a refresh
const MAX = 110;        // cap how far the content follows the finger

// Pull-to-refresh: drag down from the top of the page → a spinner appears and `onRefresh` runs.
// Listeners are attached natively (passive:false) so touchmove can be preventDefault'd while pulling,
// which blocks the browser's own overscroll/bounce. Only engages when the page is scrolled to the top.
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void>; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const busyRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const [animate, setAnimate] = useState(false);

  const set = (v: number) => { pullRef.current = v; setPull(v); };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const start = (e: TouchEvent) => {
      if (busyRef.current) return;
      startY.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
      setAnimate(false);
    };
    const move = (e: TouchEvent) => {
      if (startY.current === null || busyRef.current) return;
      if (window.scrollY > 0) { startY.current = null; set(0); return; }
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { set(0); return; }       // pulling up → let the page scroll normally
      set(Math.min(MAX, dy * 0.5));           // rubber-band resistance
      e.preventDefault();                     // block native overscroll/bounce while pulling down
    };
    const end = async () => {
      if (startY.current === null) return;
      startY.current = null;
      setAnimate(true);
      if (pullRef.current >= THRESHOLD && !busyRef.current) {
        busyRef.current = true; setBusy(true); set(THRESHOLD);
        try { await onRefreshRef.current(); } catch { /* error is surfaced by the screen itself */ }
        busyRef.current = false; setBusy(false); set(0);
      } else {
        set(0);
      }
    };

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  const offset = busy ? THRESHOLD : pull;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: offset,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', pointerEvents: 'none', opacity: offset > 6 ? 1 : 0,
      }}>
        <Spinner />
      </div>
      <div style={{ transform: `translateY(${offset}px)`, transition: animate ? 'transform .25s ease' : 'none', willChange: 'transform' }}>
        {children}
      </div>
    </div>
  );
}
