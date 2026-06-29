export interface PushParams { time?: string; fecha?: string; slot?: string }
type Builder = (p: PushParams) => { title: string; body: string };

// YYYYMMDD → DD.MM.YYYY (human-readable in notifications). Leaves anything else untouched.
function fmtDate(ymd?: string): string {
  if (!ymd) return '';
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(ymd);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ymd;
}

const TABLE: Record<string, Record<string, Builder>> = {
  uk: {
    freed: (p) => ({ title: '🆓 Pádel', body: `Звільнився слот ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
    grabbed: (p) => ({ title: '🎯 Pádel', body: `Перехопив слот ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
    limitOff: () => ({ title: 'Pádel', body: 'Авто-перехоплення вимкнено: ліміт 3/тиждень' }),
    watchExpired: (p) => ({ title: 'Pádel', body: `Ловля ${fmtDate(p.fecha)} минула`.trim() }),
    myCancelled: (p) => ({ title: '❌ Pádel', body: `Скасували твою бронь ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
  },
  en: {
    freed: (p) => ({ title: '🆓 Pádel', body: `Slot freed ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
    grabbed: (p) => ({ title: '🎯 Pádel', body: `Grabbed slot ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
    limitOff: () => ({ title: 'Pádel', body: 'Auto-grab disabled: weekly limit of 3 reached' }),
    watchExpired: (p) => ({ title: 'Pádel', body: `Watch ${fmtDate(p.fecha)} expired`.trim() }),
    myCancelled: (p) => ({ title: '❌ Pádel', body: `Your booking ${p.time ?? ''} ${fmtDate(p.fecha)} was cancelled`.trim() }),
  },
  ru: {
    freed: (p) => ({ title: '🆓 Pádel', body: `Освободился слот ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
    grabbed: (p) => ({ title: '🎯 Pádel', body: `Перехватил слот ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
    limitOff: () => ({ title: 'Pádel', body: 'Авто-перехват выключен: лимит 3/нед' }),
    watchExpired: (p) => ({ title: 'Pádel', body: `Ловля ${fmtDate(p.fecha)} истекла`.trim() }),
    myCancelled: (p) => ({ title: '❌ Pádel', body: `Отменили твою бронь ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
  },
  es: {
    freed: (p) => ({ title: '🆓 Pádel', body: `Turno libre ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
    grabbed: (p) => ({ title: '🎯 Pádel', body: `Turno capturado ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
    limitOff: () => ({ title: 'Pádel', body: 'Captura automática desactivada: límite 3/semana' }),
    watchExpired: (p) => ({ title: 'Pádel', body: `Captura ${fmtDate(p.fecha)} expirada`.trim() }),
    myCancelled: (p) => ({ title: '❌ Pádel', body: `Cancelaron tu reserva ${p.time ?? ''} ${fmtDate(p.fecha)}`.trim() }),
  },
};

export function buildPushText(locale: string, type: string, params: PushParams): { title: string; body: string } {
  const lang = TABLE[locale] ? locale : 'uk';
  const fn = TABLE[lang][type];
  return fn ? fn(params) : { title: 'Pádel', body: '' };
}
