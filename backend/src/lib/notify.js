'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');

/**
 * Dispatch a deploy notification to a configured URL.
 *
 * Supports:
 *  - Plain https:// / http:// webhook URLs — POST JSON directly
 *  - Apprise-protocol URLs (discord://, slack://, tgram://, etc.) — requires a
 *    self-hosted Apprise API instance; set APPRISE_API_URL env var to enable.
 *
 * @param {string} notifyUrl  - destination URL
 * @param {object} payload    - { event, profile, success, message, timestamp }
 */
async function send(notifyUrl, payload) {
  if (!notifyUrl) return;

  // Generic http/https webhook
  if (notifyUrl.startsWith('https://') || notifyUrl.startsWith('http://')) {
    await postJson(notifyUrl, payload);
    return;
  }

  // Apprise-protocol — requires local Apprise API server
  const appriseApi = process.env.APPRISE_API_URL;
  if (appriseApi) {
    const body = {
      urls:  notifyUrl,
      title: `WDP: ${payload.profile} — ${payload.event}`,
      body:  payload.message || JSON.stringify(payload),
    };
    await postJson(`${appriseApi}/notify`, body);
    return;
  }

  console.warn(`[notify] Apprise URL requires APPRISE_API_URL env var to be set: ${notifyUrl.substring(0, 30)}...`);
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { return reject(new Error(`Invalid notification URL: ${url}`)); }

    const data = JSON.stringify(body);
    const options = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent':     'WapplerDeploymentPipeline/1.0',
      },
      timeout: 10000,
    };

    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      res.resume(); // drain response body
      resolve(res.statusCode);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Notification request timed out')); });
    req.write(data);
    req.end();
  });
}

module.exports = { send };
