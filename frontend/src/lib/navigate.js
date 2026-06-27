import { browser } from '$app/environment';

/** URL-safe path for a deployment profile dashboard page. */
export function profilePath(name) {
  return `/dashboard/${encodeURIComponent(name)}`;
}

/**
 * Full navigation — reliable when SvelteKit client routing stalls (static adapter, Docker, etc.).
 */
export function hardNavigate(url) {
  if (browser) window.location.assign(url);
}
