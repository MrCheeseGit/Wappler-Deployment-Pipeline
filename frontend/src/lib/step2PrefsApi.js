/** Persist wizard step2 fields (rebuild dismiss, target OS) on the saved profile. */
export async function saveStep2Prefs(api, profileName, step2Patch) {
  if (!profileName || !step2Patch || typeof step2Patch !== 'object') return;
  await api.patch(`/api/config/profiles/${encodeURIComponent(profileName)}/step2`, step2Patch);
}
