'use strict';

const SUPPORTED = ['en', 'pt', 'es', 'de', 'nl'];
const FALLBACK = 'en';

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

const TEMPLATES = {
  en: {
    test: () => 'WDP test: your SMS notifications are working.',
    deploy_success: (p) => `WDP: Deploy "${p.profile}" succeeded (${fmtTime(p.timestamp)}).`,
    deploy_failed: (p) => `WDP: Deploy "${p.profile}" failed. ${p.detail || 'See deploy logs.'}`,
    rollback: (p) => `WDP: Rollback started for profile "${p.profile}".`,
  },
  pt: {
    test: () => 'Teste WDP: as notificações SMS estão configuradas corretamente.',
    deploy_success: (p) => `WDP: Implementação "${p.profile}" concluída com sucesso (${fmtTime(p.timestamp)}).`,
    deploy_failed: (p) => `WDP: Implementação "${p.profile}" falhou. ${p.detail || 'Consulte os registos.'}`,
    rollback: (p) => `WDP: Reversão iniciada para o perfil "${p.profile}".`,
  },
  es: {
    test: () => 'Prueba WDP: las notificaciones SMS están configuradas correctamente.',
    deploy_success: (p) => `WDP: Despliegue "${p.profile}" completado (${fmtTime(p.timestamp)}).`,
    deploy_failed: (p) => `WDP: Despliegue "${p.profile}" fallido. ${p.detail || 'Consulte los registos.'}`,
    rollback: (p) => `WDP: Reversión iniciada para el perfil "${p.profile}".`,
  },
  de: {
    test: () => 'WDP-Test: SMS-Benachrichtigungen sind korrekt eingerichtet.',
    deploy_success: (p) => `WDP: Deployment "${p.profile}" erfolgreich (${fmtTime(p.timestamp)}).`,
    deploy_failed: (p) => `WDP: Deployment "${p.profile}" fehlgeschlagen. ${p.detail || 'Logs prüfen.'}`,
    rollback: (p) => `WDP: Rollback für Profil "${p.profile}" gestartet.`,
  },
  nl: {
    test: () => 'WDP-test: SMS-meldingen zijn correct geconfigureerd.',
    deploy_success: (p) => `WDP: Deployment "${p.profile}" geslaagd (${fmtTime(p.timestamp)}).`,
    deploy_failed: (p) => `WDP: Deployment "${p.profile}" mislukt. ${p.detail || 'Bekijk de logs.'}`,
    rollback: (p) => `WDP: Terugdraaien gestart voor profiel "${p.profile}".`,
  },
};

function buildMessage(event, locale, params = {}) {
  const lang = SUPPORTED.includes(locale) ? locale : FALLBACK;
  const pack = TEMPLATES[lang] || TEMPLATES[FALLBACK];
  const fn = pack[event] || TEMPLATES[FALLBACK][event];
  if (!fn) return TEMPLATES[FALLBACK].test();
  let body = fn(params);
  if (params.logExcerpt) {
    const excerpt = String(params.logExcerpt).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (excerpt) body += ` ${excerpt}`;
  }
  return body.slice(0, 480);
}

module.exports = { buildMessage, SUPPORTED, FALLBACK };
