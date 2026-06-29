import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, ymdToDate } from '../lib/dates';
import { CALENDAR_DAYS, BOOKING_HORIZON_DAYS } from '../config';

interface Props {
  todayYmd: string;
  selected: string;
  onSelect: (ymd: string) => void;
}

export function DateStrip({ todayYmd, selected, onSelect }: Props) {
  const { i18n } = useTranslation();
  const days = Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(todayYmd, i));
  const fmtW = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
  const fmtM = new Intl.DateTimeFormat(i18n.language, { month: 'short' });

  // Keep the selected day visible — e.g. a deep-link from a push can select a day that's scrolled
  // off to the right; without this the highlight is there but not on screen. (today is index 0, so
  // centering it at mount is a no-op — nothing to its left to scroll.)
  const selRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { selRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); }, [selected]);

  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '6px 14px 10px' }}>
      {days.map((ymd, i) => {
        const d = ymdToDate(ymd);
        const sel = ymd === selected;
        const beyond = i > BOOKING_HORIZON_DAYS;
        return (
          <button
            key={ymd}
            ref={sel ? selRef : undefined}
            onClick={() => onSelect(ymd)}
            style={{
              flex: '0 0 auto', width: 46, textAlign: 'center', padding: '7px 0',
              borderRadius: 12, border: '1px solid ' + (sel ? '#1d4ed8' : '#1f2b3c'),
              background: sel ? '#1d4ed8' : '#121b28', color: '#e7eefb',
              opacity: beyond ? 0.4 : 1,
            }}
          >
            <div style={{ fontSize: 10, color: sel ? '#cfe0ff' : '#90a4bf' }}>{fmtW.format(d)}</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{d.getDate()}</div>
            <div style={{ fontSize: 9.5, color: sel ? '#cfe0ff' : '#90a4bf' }}>{fmtM.format(d)}</div>
          </button>
        );
      })}
    </div>
  );
}
