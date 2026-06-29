import { useEffect, useRef, useState, type ReactNode } from 'react';

const THRESHOLD = 70;   // px pulled (after resistance) needed to trigger a refresh
const MAX = 110;        // cap how far the content follows the finger

// Pull-to-refresh: drag down from the top → on release past the threshold, `onRefresh` fires in the
// BACKGROUND and the content snaps straight back. No held top spinner — the screen shows its own
// "refreshing" text/pill while onRefresh runs. Listeners are native (passive:false) so touchmove can
// preventDefault the browser's overscroll/bounce. Only engages when the page is scrolled to the top.
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void> | void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const [pull, setPull] = useState(0);
  const [animate, setAnimate] = useState(false);

  const set = (v: number) => { pullRef.current = v; setPull(v); };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const start = (e: TouchEvent) => {
      startY.current = window.scrollY <= 0 ? e.touches[0].clientY : null;
      setAnimate(false);
    };
    const move = (e: TouchEvent) => {
      if (startY.current === null) return;
      if (window.scrollY > 0) { startY.current = null; set(0); return; }
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { set(0); return; }       // pulling up → let the page scroll normally
      set(Math.min(MAX, dy * 0.5));           // rubber-band resistance
      e.preventDefault();                     // block native overscroll/bounce while pulling down
    };
    const end = () => {
      if (startY.current === null) return;
      startY.current = null;
      setAnimate(true);
      if (pullRef.current >= THRESHOLD) void onRefreshRef.current();   // fire in the background; the screen shows "refreshing"
      set(0);                                                          // snap back immediately — no held spinner
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

  return (
    <div ref={ref}>
      <div style={{ transform: `translateY(${pull}px)`, transition: animate ? 'transform .25s ease' : 'none', willChange: 'transform' }}>
        {children}
      </div>
    </div>
  );
}
