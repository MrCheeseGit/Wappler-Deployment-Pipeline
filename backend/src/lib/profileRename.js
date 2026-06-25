'use strict';

const fs = require('fs');
const path = require('path');
const { readHistoryFile, writeHistoryFile } = require('./deployHistory');

const HISTORY_PATH = process.env.HISTORY_PATH || '/data/deploy-history.json';
const GENERATED_FILES = ['docker-compose.deploy.yml', 'Dockerfile.deploy', '.env.deploy'];

/** Rewrite wdp/{oldName}/ paths inside generated files after a profile rename. */
function patchGeneratedFilesForRename(projectPath, oldName, newName) {
  if (!projectPath || oldName === newName) return;
  const dir = path.join(projectPath, 'wdp', newName);
  if (!fs.existsSync(dir)) return;

  const from = `wdp/${oldName}/`;
  const to = `wdp/${newName}/`;

  for (const name of GENERATED_FILES) {
    const fp = path.join(dir, name);
    if (!fs.existsSync(fp)) continue;
    let text = fs.readFileSync(fp, 'utf8');
    if (!text.includes(from) && !text.includes(`# Profile: ${oldName}`)) continue;
    text = text.split(from).join(to);
    text = text.replace(`# Profile: ${oldName}`, `# Profile: ${newName}`);
    fs.writeFileSync(fp, text, 'utf8');
  }
}

/** Keep deploy history / Publish eligibility aligned with the new profile name. */
async function migrateDeployHistoryProfile(oldName, newName) {
  if (oldName === newName) return;
  const { history } = await readHistoryFile(HISTORY_PATH);
  let changed = false;

  for (const entry of history.entries || []) {
    if (entry.profile === oldName) {
      entry.profile = newName;
      changed = true;
    }
  }

  const rollup = history.rollup?.byProfile;
  if (rollup?.[oldName]) {
    rollup[newName] = rollup[oldName];
    delete rollup[oldName];
    changed = true;
  }

  if (changed) {
    await writeHistoryFile(HISTORY_PATH, history);
  }
}

module.exports = { patchGeneratedFilesForRename, migrateDeployHistoryProfile };
