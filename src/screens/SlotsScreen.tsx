import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateStrip } from '../components/DateStrip';
import { SlotRow } from '../components/SlotRow';
import { deriveSlots } from '../lib/status';
import { fetchFranjas, fetchReservations, fetchWeekdayBlocks, fetchDayBlock } from '../lib/izar4Client';
import { getDeviceSecret } from '../lib/deviceSecret';
import { dateToYmd } from '../lib/dates';
import type { SlotView } from '../lib/types';

export function SlotsScreen() {
  const { t } = useTranslation();
  const today = dateToYmd(new Date());
  const [selected, setSelected] = useState(today);
  const [slots, setSlots] = useState<SlotView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const secret = getDeviceSecret();
    setSlots(null); setError(null); setBlockedMsg(null);
    (async () => {
      try {
        const [franjas, reservations, weekdayBlocks, dayBlock] = await Promise.all([
          fetchFranjas(secret),
          fetchReservations(secret, selected),
          fetchWeekdayBlocks(secret),
          fetchDayBlock(secret, selected),
        ]);
        if (cancelled) return;
        if (dayBlock) { setBlockedMsg(dayBlock.motivo || t('slots.dayBlocked')); setSlots([]); return; }
        setSlots(deriveSlots({
          fecha: selected, franjas, reservations, weekdayBlocks,
          dayBlocked: false, now: new Date(),
        }));
      } catch {
        if (!cancelled) setError(t('slots.error'));
      }
    })();
    return () => { cancelled = true; };
  }, [selected, t]);

  return (
    <div style={{ maxWidth: 420, margin: '0 auto' }}>
      <header style={{ textAlign: 'center', padding: '12px 0', fontSize: 17, fontWeight: 700 }}>
        {t('app.title')}
      </header>
      <DateStrip todayYmd={today} selected={selected} onSelect={setSelected} />
      <div style={{ padding: '2px 10px 8px' }}>
        {error && <div style={{ padding: 16, color: '#ff9b9b' }}>{error}</div>}
        {blockedMsg && <div style={{ padding: 16, color: '#f2c14e' }}>{blockedMsg}</div>}
        {!error && !blockedMsg && slots === null && (
          <div style={{ padding: 16, color: '#8aa0bd' }}>{t('slots.loading')}</div>
        )}
        {slots?.map((s) => <SlotRow key={s.franja.slot} slot={s} />)}
      </div>
    </div>
  );
}
