export interface PushParams { time?: string; fecha?: string }
type Builder = (p: PushParams) => { title: string; body: string };

const TABLE: Record<string, Record<string, Builder>> = {
  uk: {
    freed: (p) => ({ title: '🆓 Pádel', body: `Звільнився слот ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
    grabbed: (p) => ({ title: '🎯 Pádel', body: `Перехопив слот ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
    limitOff: () => ({ title: 'Pádel', body: 'Авто-перехоплення вимкнено: ліміт 3/тиждень' }),
    watchExpired: (p) => ({ title: 'Pádel', body: `Ловля ${p.fecha ?? ''} минула`.trim() }),
    myCancelled: (p) => ({ title: '❌ Pádel', body: `Скасували твою бронь ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
  },
  en: {
    freed: (p) => ({ title: '🆓 Pádel', body: `Slot freed ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
    grabbed: (p) => ({ title: '🎯 Pádel', body: `Grabbed slot ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
    limitOff: () => ({ title: 'Pádel', body: 'Auto-grab disabled: weekly limit of 3 reached' }),
    watchExpired: (p) => ({ title: 'Pádel', body: `Watch ${p.fecha ?? ''} expired`.trim() }),
    myCancelled: (p) => ({ title: '❌ Pádel', body: `Your booking ${p.time ?? ''} ${p.fecha ?? ''} was cancelled`.trim() }),
  },
  ru: {
    freed: (p) => ({ title: '🆓 Pádel', body: `Освободился слот ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
    grabbed: (p) => ({ title: '🎯 Pádel', body: `Перехватил слот ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
    limitOff: () => ({ title: 'Pádel', body: 'Авто-перехват выключен: лимит 3/нед' }),
    watchExpired: (p) => ({ title: 'Pádel', body: `Ловля ${p.fecha ?? ''} истекла`.trim() }),
    myCancelled: (p) => ({ title: '❌ Pádel', body: `Отменили твою бронь ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
  },
  es: {
    freed: (p) => ({ title: '🆓 Pádel', body: `Turno libre ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
    grabbed: (p) => ({ title: '🎯 Pádel', body: `Turno capturado ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
    limitOff: () => ({ title: 'Pádel', body: 'Captura automática desactivada: límite 3/semana' }),
    watchExpired: (p) => ({ title: 'Pádel', body: `Captura ${p.fecha ?? ''} expirada`.trim() }),
    myCancelled: (p) => ({ title: '❌ Pádel', body: `Cancelaron tu reserva ${p.time ?? ''} ${p.fecha ?? ''}`.trim() }),
  },
};

export function buildPushText(locale: string, type: string, params: PushParams): { title: string; body: string } {
  const lang = TABLE[locale] ? locale : 'uk';
  const fn = TABLE[lang][type];
  return fn ? fn(params) : { title: 'Pádel', body: '' };
}
