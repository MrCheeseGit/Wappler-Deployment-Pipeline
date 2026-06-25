'use strict';

const fs = require('fs');
const path = require('path');

function resolveDocsRoot() {
  const candidates = [
    process.env.WDP_DOCS_ROOT,
    path.join(__dirname, '../../application_documentation'),
    path.join(__dirname, '../../../application_documentation'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return path.join(__dirname, '../../application_documentation');
}

const DOCS_ROOT = resolveDocsRoot();

/** @type {{ slug: string, file: string, titleKey: string }[]} */
const HELP_CATALOG = [
  { slug: 'how-it-works', file: 'how-it-works.md', titleKey: 'help.docs.howItWorks' },
  { slug: 'beta', file: 'beta.md', titleKey: 'help.docs.beta' },
  { slug: 'installation', file: 'installation.md', titleKey: 'help.docs.installation' },
  { slug: 'troubleshooting-deploy-server', file: 'troubleshooting-deploy-server.md', titleKey: 'help.docs.troubleshootingDeployServer' },
  { slug: 'redis-in-production', file: 'redis-in-production.md', titleKey: 'help.docs.redisInProduction' },
  { slug: 'updating-wdp', file: 'updating-wdp.md', titleKey: 'help.docs.updatingWdp' },
  { slug: 'about', file: 'about.md', titleKey: 'help.docs.about' },
  { slug: 'host-security', file: 'host-security.md', titleKey: 'help.docs.hostSecurity' },
];

function listHelpDocs() {
  return HELP_CATALOG.map(({ slug, file, titleKey }) => {
    const full = path.join(DOCS_ROOT, file);
    return {
      slug,
      titleKey,
      available: fs.existsSync(full),
    };
  }).filter((d) => d.available);
}

function readHelpDoc(slug) {
  const entry = HELP_CATALOG.find((d) => d.slug === slug);
  if (!entry) {
    const err = new Error(`Unknown help topic: ${slug}`);
    err.status = 404;
    throw err;
  }
  const full = path.resolve(DOCS_ROOT, entry.file);
  const root = path.resolve(DOCS_ROOT);
  if (!full.startsWith(root + path.sep) && full !== root) {
    const err = new Error('Invalid document path.');
    err.status = 400;
    throw err;
  }
  if (!fs.existsSync(full)) {
    const err = new Error('Document not found on this WDP install.');
    err.status = 404;
    throw err;
  }
  return {
    slug: entry.slug,
    titleKey: entry.titleKey,
    markdown: fs.readFileSync(full, 'utf8'),
  };
}

module.exports = {
  listHelpDocs,
  readHelpDoc,
  HELP_CATALOG,
};
