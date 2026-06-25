import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'wdp_wizard';

const defaults = {
  currentStep: 1,
  maxReachedStep: 1,
  completedSteps: [],
  activeProfile: '',
  step1: {
    projectPath: '',
    profileMode: 'new',
    selectedProfile: '',
    newProfileName: '',
    detectedName: '',
    detectedVersion: '',
    detectedNodeVersion: '',
    wapplerImportPath: '',
    wapplerImportApplied: false,
    wapplerImportTarget: 0,
  },
  step2: {
    targetOS: 'ubuntu-24.04',
    architecture: 'x86_64',
    rebuildTargetOS: 'ubuntu-24.04',
    rebuildDismissed: false,
  },
  step3: {
    skipDb: false,
    dbType: 'postgres',
    dbLocation: 'managed',
    dbHost: 'db',
    dbPort: 5432,
    dbName: '',
    dbUser: '',
    dbPassword: '',
    managedDbAck: false,
    sslMode: 'disable',
    sslCaPath: '',
    sslCertPath: '',
    sslKeyPath: ''
  },
  step4: {
    hostingTarget: '',
    sshHost: '',
    sshUser: 'root',
    sshKeyPath: '~/.ssh/id_ed25519',
    remotePath: '',
    doMode: 'existing',
    doApiKey: '',
    doRegion: 'lon1',
    doSize: 's-1vcpu-1gb',
    doSshKeyId: '',
    doDropletId: ''
  },
  step5: { addons: {} },
  step6: {
    scaleHorizontal: false,
    replicas: 1,
    memLimit: '',
    cpuLimit: '',
    healthcheck: true
  },
  step7: {
    npmAudit: true,
    osvScanner: false,
    socketCli: false,
    gitleaks: false,
    trivy: false,
    grype: false,
    dockerScout: false,
    blockOnCritical: false,
    scanOnDeploy: true
  },
  step8: {},
  step9: {}
};

function load() {
  if (!browser) return { ...defaults };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaults };
}

function createWizardStore() {
  const { subscribe, set, update } = writable(load());

  if (browser) {
    subscribe(value => {
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* ignore */ }
    });
  }

  return {
    subscribe,
    set,
    update,
    reset() {
      if (browser) sessionStorage.removeItem(STORAGE_KEY);
      set({ ...defaults });
    },
    setStep(step, data) {
      update(s => ({ ...s, [`step${step}`]: { ...s[`step${step}`], ...data } }));
    },
    completeStep(step) {
      update(s => ({
        ...s,
        completedSteps: [...new Set([...s.completedSteps, step])],
        maxReachedStep: Math.max(s.maxReachedStep, step + 1),
        currentStep: step + 1
      }));
    },
    setProfile(profile) {
      update(s => ({ ...s, activeProfile: profile }));
    },
    /** Keep session wizard in sync after dashboard profile rename. */
    syncProfileRename(oldName, newName) {
      if (!oldName || !newName || oldName === newName) return;
      update((s) => {
        const step1 = { ...s.step1 };
        let changed = false;

        if (s.activeProfile === oldName) {
          changed = true;
        }
        if (step1.selectedProfile === oldName) {
          step1.selectedProfile = newName;
          changed = true;
        }
        if (step1.newProfileName === oldName) {
          step1.newProfileName = newName;
          changed = true;
        }
        if (!changed) return s;

        return {
          ...s,
          activeProfile: s.activeProfile === oldName ? newName : s.activeProfile,
          step1,
        };
      });
    },
    /** Switch deploy/generate target to a saved profile name. */
    switchActiveProfile(name) {
      if (!name) return;
      update((s) => ({
        ...s,
        activeProfile: name,
        step1: {
          ...s.step1,
          profileMode: 'existing',
          selectedProfile: name,
        },
      }));
    },
  };
}

export const wizardStore = createWizardStore();
