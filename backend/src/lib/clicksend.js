'use strict';

const { buildMessage } = require('./clicksendMessages');

const CLICKSEND_URL = 'https://rest.clicksend.com/v3/sms/send';

function formatE164(dialingCode, mobile) {
  const code = String(dialingCode || '').replace(/\D/g, '');
  let num = String(mobile || '').replace(/\D/g, '');
  if (!code || !num) return null;
  if (num.startsWith('0')) num = num.slice(1);
  return `+${code}${num}`;
}

function hasCredentials(clickSend) {
  return Boolean(clickSend?.username?.trim() && clickSend?.apiKey?.trim());
}

async function sendSms(clickSend, to, body) {
  if (!hasCredentials(clickSend)) {
    throw new Error('ClickSend credentials are not configured.');
  }
  if (!to) {
    throw new Error('Recipient phone number is missing.');
  }

  const auth = Buffer.from(`${clickSend.username.trim()}:${clickSend.apiKey.trim()}`).toString('base64');
  const res = await fetch(CLICKSEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ source: 'WDP', to, body: String(body).slice(0, 480) }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.response_msg || data.message || `ClickSend HTTP ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  const msg0 = data.data?.messages?.[0];
  if (msg0 && msg0.status && String(msg0.status).toUpperCase() !== 'SUCCESS') {
    throw new Error(msg0.status || 'ClickSend rejected the message.');
  }

  return data;
}

/**
 * Send SMS using global ClickSend config + auth profile phone/locale.
 * Never throws — logs errors only (for deploy hooks).
 */
async function dispatchSms(config, event, params = {}) {
  try {
    const clickSend = config.clickSend;
    if (!hasCredentials(clickSend)) return;

    // Explicit false only — undefined/missing defaults to enabled (legacy configs).
    if (event === 'deploy_success' && clickSend.onSuccess === false) return;
    if (event === 'deploy_failed' && clickSend.onFailure === false) return;
    if (event === 'rollback' && clickSend.onRollback === false) return;

    const auth = config.auth || {};
    const to = formatE164(auth.dialingCode, auth.mobile);
    if (!to) {
      console.warn('[clicksend] No mobile number on user profile — SMS skipped.');
      return;
    }

    const locale = params.locale || auth.locale || 'en';
    const body = buildMessage(event, locale, params);
    await sendSms(clickSend, to, body);
  } catch (err) {
    console.error('[clicksend]', err.message);
  }
}

module.exports = {
  formatE164,
  hasCredentials,
  sendSms,
  dispatchSms,
  buildMessage,
};
