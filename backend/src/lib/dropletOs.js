'use strict';

/** Map DO image slug → wizard step2 targetOS value (best-effort). */
const SLUG_TO_WIZARD_OS = {
  'ubuntu-24-04-x64': 'ubuntu-24.04',
  'ubuntu-24-04-aarch64': 'ubuntu-24.04',
  'ubuntu-22-04-x64': 'ubuntu-22.04',
  'ubuntu-22-04-aarch64': 'ubuntu-22.04',
  'debian-12-x64': 'debian-12',
  'debian-12-aarch64': 'debian-12',
};

const WIZARD_OS_LABELS = {
  'ubuntu-24.04': 'Ubuntu Server 24.04 LTS',
  'ubuntu-22.04': 'Ubuntu Server 22.04 LTS',
  'debian-12': 'Debian 12 (Bookworm)',
  alpine: 'Alpine Linux',
};

/** @param {string} slug */
function archFromImageSlug(slug) {
  if (!slug) return null;
  if (slug.includes('aarch64')) return 'arm64';
  if (slug.includes('x64')) return 'x86_64';
  return null;
}

/**
 * @param {object} image — DigitalOcean droplet.image object
 * @returns {{ imageSlug: string, imageName: string, imageLabel: string, wizardOs: string|null, wizardArch: string|null, distribution: string }}
 */
function formatDropletImage(image = {}) {
  const slug = String(image.slug || '').trim();
  const name = String(image.name || image.description || slug || 'Unknown image').trim();
  const distribution = String(image.distribution || '').trim();

  let imageLabel = name;
  const slugMatch = slug.match(/^(ubuntu|debian)-(\d+)-(\d+)-(x64|aarch64)$/);
  if (slugMatch) {
    const [, dist, major, minor] = slugMatch;
    const distTitle = dist === 'ubuntu' ? 'Ubuntu Server' : 'Debian';
    imageLabel = `${distTitle} ${major}.${minor} LTS`;
    if (dist === 'debian') imageLabel = `Debian ${major} (Bookworm)`;
  } else if (distribution && name) {
    imageLabel = `${distribution} — ${name}`;
  }

  const wizardOs = SLUG_TO_WIZARD_OS[slug] || null;

  return {
    imageSlug: slug || '—',
    imageName: name || '—',
    imageLabel,
    wizardOs,
    wizardArch: archFromImageSlug(slug),
    distribution: distribution || '—',
  };
}

function wizardOsLabel(value) {
  return WIZARD_OS_LABELS[value] || value || '—';
}

module.exports = {
  formatDropletImage,
  archFromImageSlug,
  wizardOsLabel,
  SLUG_TO_WIZARD_OS,
  WIZARD_OS_LABELS,
};
