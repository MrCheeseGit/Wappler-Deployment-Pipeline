'use strict';

const { checkFiles } = require('./preDeployChecks');
const { readHistoryFile } = require('./deployHistory');

const HISTORY_PATH = process.env.HISTORY_PATH || '/data/deploy-history.json';

/**
 * Whether "Publish changes" should be offered for this profile.
 * Requires at least one successful deploy and generated files on disk.
 */
async function getPublishEligibility(profileName, profile) {
  const files = checkFiles(profile?.projectPath, profileName);
  if (!files.ok) {
    return { canPublish: false, hasSuccessfulDeploy: false, reason: 'missing_generated_files' };
  }

  const { history } = await readHistoryFile(HISTORY_PATH);
  const hasSuccessfulDeploy = history.entries.some(
    (e) => e.profile === profileName && e.outcome === 'success',
  );
  if (!hasSuccessfulDeploy) {
    return { canPublish: false, hasSuccessfulDeploy: false, reason: 'no_successful_deploy' };
  }

  const target = profile.hostingTarget || profile.wizardConfig?.step4?.hostingTarget || '';
  const isProvision =
    target === 'digitalocean' &&
    (profile.doMode || profile.wizardConfig?.step4?.doMode) === 'provision' &&
    !profile.sshHost;

  if (isProvision) {
    return { canPublish: false, hasSuccessfulDeploy: true, reason: 'awaiting_first_provision' };
  }

  if ((target === 'digitalocean' || target === 'vps') && !profile.sshHost) {
    return { canPublish: false, hasSuccessfulDeploy: true, reason: 'no_ssh_host' };
  }

  return { canPublish: true, hasSuccessfulDeploy: true, reason: null };
}

module.exports = { getPublishEligibility };
