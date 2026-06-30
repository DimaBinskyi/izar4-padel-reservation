import { useCallback, useRef, useState } from 'react';

export type ToastVariant = 'success' | 'warn';
export interface ToastState {
  msg: string;
  variant: ToastVariant;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((msg: string, variant: ToastVariant = 'success') => {
    setToast({ msg, variant });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3800);
  }, []);
  return { toast, show };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  const warn = toast.variant === 'warn';
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, top: 'calc(env(safe-area-inset-top) + 12px)', display: 'flex', justifyContent: 'center', zIndex: 70, pointerEvents: 'none' }}>
      <div
        style={{
          maxWidth: 360,
          margin: '0 14px',
          borderRadius: 12,
          padding: '10px 14px',
          fontSize: 12.5,
          boxShadow: '0 6px 20px rgba(0,0,0,.4)',
          ...(warn
            ? { background: '#241a00', border: '1px solid #4a3a12', color: '#f2c14e' }
            : { background: '#0e2018', border: '1px solid #234e34', color: '#a7e8c1' }),
        }}
      >
        {warn ? '⚠️ ' : ''}
        {toast.msg}
      </div>
    </div>
  );
}
