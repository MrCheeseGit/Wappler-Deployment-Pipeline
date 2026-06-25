/** Normalise project paths for comparison (trailing slashes). */
export function normProjectPath(p) {
  return (p || '').trim().replace(/\/+$/, '');
}

/**
 * Detect when browser wizard state disagrees with saved profiles (e.g. after rename).
 * Intentionally does not warn when multiple profiles share a project path (local + remote is valid).
 * @returns {{ kind: 'missing'|'server_name', active: string, suggested: string[] } | null}
 */
export function getWizardProfileMismatch(wz, profileData) {
  const active = (wz?.activeProfile || '').trim();
  const projectPath = normProjectPath(wz?.step1?.projectPath);
  if (!active) return null;

  const names = Object.keys(profileData || {});

  if (!names.includes(active)) {
    const byPath = names.filter(
      (n) => normProjectPath(profileData[n]?.projectPath) === projectPath && projectPath,
    );
    return { kind: 'missing', active, suggested: byPath };
  }

  const savedActive = (profileData[active]?.wizardConfig?.activeProfile || '').trim();
  if (savedActive && savedActive !== active) {
    return { kind: 'server_name', active, suggested: [savedActive] };
  }

  return null;
}
