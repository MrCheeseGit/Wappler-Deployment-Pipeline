/** @param {import('$lib/api.js').api} api */
export async function fetchHostOs(api, { profile = '', dropletId = '', sshHost = '', apiKey = '' } = {}) {
  const params = new URLSearchParams();
  if (profile) params.set('profile', profile);
  if (dropletId) params.set('dropletId', String(dropletId));
  if (sshHost?.trim()) params.set('sshHost', sshHost.trim());
  if (apiKey?.trim()) params.set('apiKey', apiKey.trim());
  const qs = params.toString();
  if (!qs) return null;
  return api.get(`/api/config/digitalocean/host-os?${qs}`);
}
