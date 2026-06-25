import { browser } from '$app/environment';
import { init, register, locale } from 'svelte-i18n';

const LOCALE_KEY = 'wdp_locale';
const SUPPORTED   = ['en', 'pt', 'es', 'de', 'nl'];
const FALLBACK    = 'en';

register('en', () => import('./locales/en.json'));
register('pt', () => import('./locales/pt.json'));
register('es', () => import('./locales/es.json'));
register('de', () => import('./locales/de.json'));
register('nl', () => import('./locales/nl.json'));

export function initI18n() {
  let initialLocale = FALLBACK;

  if (browser) {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored && SUPPORTED.includes(stored)) {
      initialLocale = stored;
    } else {
      // Best-effort browser locale matching
      const browserLang = navigator.language?.split('-')[0];
      if (browserLang && SUPPORTED.includes(browserLang)) {
        initialLocale = browserLang;
      }
    }
  }

  init({
    fallbackLocale: FALLBACK,
    initialLocale,
  });
}

export function setLocale(lang) {
  if (!SUPPORTED.includes(lang)) return;
  locale.set(lang);
  if (browser) localStorage.setItem(LOCALE_KEY, lang);
}

export { locale, SUPPORTED };
