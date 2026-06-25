/**
 * Client-side helpers for "wizard changed since last generate" detection.
 */

function normalizeDomain(raw) {
  if (raw == null) return '';
  let host = String(raw).trim();
  if (!host) return '';
  host = host.replace(/^https?:\/\//i, '');
  host = host.split('/')[0].split('?')[0].split('#')[0];
  host = host.replace(/:\d+$/, '');
  host = host.replace(/\.$/, '');
  return host.trim().toLowerCase();
}

/** Settings that affect Dockerfile / compose / .env.deploy (matches backend). */
export function generateRelevantFingerprint(wz) {
  if (!wz) return '';

  const step1 = wz.step1 || {};
  const step2 = wz.step2 || {};
  const step3 = wz.step3 || {};
  const step4 = wz.step4 || {};
  const step5 = wz.step5 || {};
  const step6 = wz.step6 || {};

  const addons = step5.addons ? { ...step5.addons } : {};
  if (addons.traefik?.domain) {
    addons.traefik = {
      ...addons.traefik,
      domain: normalizeDomain(addons.traefik.domain),
    };
  }
  if (addons.plausible?.domain) {
    addons.plausible = {
      ...addons.plausible,
      domain: normalizeDomain(addons.plausible.domain),
    };
  }

  return JSON.stringify({
    step1: {
      projectPath: step1.projectPath || '',
      detectedName: step1.detectedName || '',
      detectedNodeVersion: step1.detectedNodeVersion || '',
    },
    step2: {
      targetOS: step2.targetOS || '',
      architecture: step2.architecture || '',
    },
    step3,
    step4: {
      hostingTarget: step4.hostingTarget || '',
    },
    step5: { ...step5, addons },
    step6,
  });
}

/** @deprecated Full wizard JSON — use generateRelevantFingerprint for stale checks. */
export function wizardFingerprint(wz) {
  if (!wz) return '';
  const copy = { ...wz };
  delete copy.currentStep;
  delete copy.maxReachedStep;
  delete copy.completedSteps;
  delete copy.activeProfile;
  return JSON.stringify(copy);
}

/** True when session wizard differs from last saved profile wizardConfig (generate-relevant only). */
export function isWizardDirty(current, savedWizardConfig) {
  if (!savedWizardConfig) return false;
  return generateRelevantFingerprint(current) !== generateRelevantFingerprint(savedWizardConfig);
}

export function mergeStaleState(serverStale, localDirty) {
  const serverIsStale = Boolean(serverStale?.stale);
  if (!serverIsStale && !localDirty) {
    return { stale: false, reasons: [] };
  }
  const reasons = serverIsStale ? [...(serverStale.reasons || [])] : [];
  if (localDirty && !reasons.includes('config_changed') && !reasons.includes('unsaved_wizard')) {
    reasons.push('unsaved_wizard');
  }
  return {
    stale: serverIsStale || localDirty,
    reasons,
    generatedAt: serverStale?.generatedAt,
    configUpdatedAt: serverStale?.configUpdatedAt,
    missingFiles: serverStale?.missingFiles,
  };
}
