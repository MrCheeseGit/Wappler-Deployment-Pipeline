'use strict';

/**
 * Normalize a user-entered hostname for DNS / Traefik (trim, strip URL parts, port).
 * Leading tabs/spaces cause dns.resolve4 EBADNAME — common when pasting from spreadsheets.
 */
function normalizeHostname(raw) {
  if (raw == null) return '';
  let host = String(raw).trim();
  if (!host) return '';

  host = host.replace(/^https?:\/\//i, '');
  host = host.split('/')[0].split('?')[0].split('#')[0];
  host = host.replace(/:\d+$/, '');
  host = host.replace(/\.$/, '');
  return host.trim().toLowerCase();
}

module.exports = { normalizeHostname };
