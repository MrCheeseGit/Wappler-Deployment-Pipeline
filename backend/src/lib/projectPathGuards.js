'use strict';

const path = require('path');

function resolveProfileProjectPath(profileData) {
  const raw = profileData?.projectPath || profileData?.wizardConfig?.step1?.projectPath;
  return raw ? path.resolve(String(raw)) : null;
}

function profileHostingTarget(data) {
  return (data?.hostingTarget || data?.wizardConfig?.step4?.hostingTarget || '').trim();
}

/**
 * Other profiles that use the same resolved project directory.
 * @param {object} config
 * @param {string} projectPath
 * @param {string} [excludeProfile]
 * @param {{ hostingTarget?: string }} [opts] When set, only profiles with the same hosting target count (local + remote on one project is allowed).
 * @returns {string[]}
 */
function profilesSharingProjectPath(config, projectPath, excludeProfile, opts = {}) {
  if (!projectPath) return [];
  const target = path.resolve(projectPath);
  const { hostingTarget } = opts;
  const names = [];
  for (const [name, data] of Object.entries(config.profiles || {})) {
    if (excludeProfile && name === excludeProfile) continue;
    const resolved = resolveProfileProjectPath(data);
    if (!resolved || resolved !== target) continue;
    if (hostingTarget) {
      const otherTarget = profileHostingTarget(data);
      if (otherTarget && otherTarget !== hostingTarget) continue;
    }
    names.push(name);
  }
  return names;
}

module.exports = {
  resolveProfileProjectPath,
  profileHostingTarget,
  profilesSharingProjectPath,
};
