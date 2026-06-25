/**
 * Merge top-level profile fields (updated by deploy/provision) into wizard step4.
 * wizardConfig.step4 is often stale after a Droplet is provisioned.
 */
const SESSION_KEYS = ['currentStep', 'maxReachedStep', 'completedSteps'];

/** Remove session-only navigation fields before persisting wizardConfig to the server. */
export function stripWizardSession(config) {
  if (!config || typeof config !== 'object') return config;
  const copy = { ...config };
  for (const k of SESSION_KEYS) delete copy[k];
  return copy;
}

/**
 * Apply saved profile wizard data without clobbering in-session step navigation.
 */
export function applyMergedWizardConfig(current, merged) {
  if (!merged) return current;
  return {
    ...merged,
    currentStep: current?.currentStep ?? merged.currentStep ?? 1,
    maxReachedStep: Math.max(current?.maxReachedStep ?? 1, merged.maxReachedStep ?? 1),
    completedSteps: current?.completedSteps?.length
      ? current.completedSteps
      : (merged.completedSteps || []),
  };
}

export function mergeProfileIntoWizard(saved, profileName) {
  if (!saved?.wizardConfig) return null;

  const wc = structuredClone(saved.wizardConfig);
  wc.activeProfile = profileName;

  const s4 = wc.step4 || {};
  wc.step4 = {
    ...s4,
    hostingTarget: saved.hostingTarget || s4.hostingTarget || '',
    sshHost:       saved.sshHost       || s4.sshHost       || '',
    sshUser:       saved.sshUser       || s4.sshUser       || 'root',
    sshKeyPath:    saved.sshKeyPath    || s4.sshKeyPath    || '~/.ssh/id_ed25519',
    remotePath:    saved.remotePath    || s4.remotePath    || '',
    doMode:        saved.doMode        || s4.doMode        || 'existing',
    doApiKey:      saved.doApiKey      || s4.doApiKey      || '',
    doRegion:      saved.doRegion      || s4.doRegion      || 'lon1',
    doSize:        saved.doSize        || s4.doSize        || 's-1vcpu-1gb',
    doSshKeyId:    saved.doSshKeyId    || s4.doSshKeyId    || '',
    doDropletId:   saved.doDropletId   || s4.doDropletId   || '',
    hostOsLabel:   saved.hostOsLabel   || s4.hostOsLabel   || '',
    hostOsSlug:    saved.hostOsSlug    || s4.hostOsSlug    || '',
    hostOsWizard:  saved.hostOsWizard  ?? s4.hostOsWizard ?? '',
  };

  return wc;
}
