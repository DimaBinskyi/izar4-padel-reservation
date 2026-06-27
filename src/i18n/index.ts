import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uk from './locales/uk.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
import es from './locales/es.json';

const STORAGE_KEY = 'padel_lang';
const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;

void i18n.use(initReactI18next).init({
  resources: { uk: { translation: uk }, en: { translation: en }, ru: { translation: ru }, es: { translation: es } },
  lng: saved ?? 'uk',
  fallbackLng: 'uk',
  interpolation: { escapeValue: false },
});

export function setLanguage(lng: 'uk' | 'en' | 'ru' | 'es') {
  void i18n.changeLanguage(lng);
  localStorage.setItem(STORAGE_KEY, lng);
}

export default i18n;
