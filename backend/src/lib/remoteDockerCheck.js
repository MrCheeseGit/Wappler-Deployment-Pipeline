'use strict';

const { exec, exec: sshExec } = require('./ssh');

const MIN_DOCKER_MAJOR = 24;
const MIN_COMPOSE_MAJOR = 2;

const TROUBLESHOOTING_DOC = 'application_documentation/troubleshooting-deploy-server.md';

/** Bash script to install Docker CE on Ubuntu/Debian (also removes podman-docker shim). */
function buildDockerInstallBash(targetOS) {
  const isDebian = targetOS === 'debian-12';
  const dockerDistro = isDebian ? 'debian' : 'ubuntu';
  return [
    '#!/bin/bash',
    'set -e',
    'export DEBIAN_FRONTEND=noninteractive',
    'if dpkg -l podman-docker 2>/dev/null | grep -q "^ii"; then',
    '  apt-get remove -y podman-docker podman 2>/dev/null || true',
    'fi',
    'apt-get update -qq',
    'apt-get install -y -qq ca-certificates curl',
    'install -m 0755 -d /etc/apt/keyrings',
    `curl -fsSL https://download.docker.com/linux/${dockerDistro}/gpg -o /etc/apt/keyrings/docker.asc`,
    'chmod a+r /etc/apt/keyrings/docker.asc',
    `echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${dockerDistro} $(awk -F= '/^VERSION_CODENAME/{print $2}' /etc/os-release) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null`,
    'apt-get update -qq',
    'apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
    'systemctl enable docker',
    'systemctl start docker',
    'docker info > /dev/null',
  ].join('\n');
}

/**
 * Probe Docker Engine + Compose on a remote host over SSH.
 * Returns structured status for API responses and pre-deploy checks.
 */
async function inspectRemoteDocker(sshCfg) {
  // One remote script (base64) avoids fragile quoting over SSH exec.
  const probeScript = [
    '#!/bin/bash',
    'set +e',
    'DV=$(docker version --format "{{.Server.Version}}" 2>/dev/null)',
    '[ -z "$DV" ] && DV=NOTFOUND',
    'CV=$(docker compose version --short 2>/dev/null | tr -d "v" | tr -d "\\n")',
    '[ -z "$CV" ] && CV=NOTFOUND',
    'DC=$(docker --version 2>/dev/null)',
    '[ -z "$DC" ] && DC=NOTFOUND',
    'PP=$(dpkg -l podman-docker 2>/dev/null | grep -c "^ii" || echo 0)',
    'CP=$(docker compose --progress plain version 2>&1 | head -1)',
    'OID=$( . /etc/os-release 2>/dev/null; echo "${ID:-}" )',
    'OCN=$( . /etc/os-release 2>/dev/null; echo "${VERSION_CODENAME:-}" )',
    'echo WDP_DV=$DV',
    'echo WDP_CV=$CV',
    'echo WDP_DC=$DC',
    'echo WDP_PP=$PP',
    'echo WDP_CP=$CP',
    'echo WDP_OID=$OID',
    'echo WDP_OCN=$OCN',
  ].join('\n');
  const b64 = Buffer.from(probeScript, 'utf8').toString('base64');
  const { code, stdout, stderr } = await exec(sshCfg, `echo ${JSON.stringify(b64)} | base64 -d | bash`);
  if (code !== 0 && !stdout.includes('WDP_DV=')) {
    const tail = (stderr || stdout || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(tail || `Remote Docker probe exited with code ${code}`);
  }
  const vars = {};
  for (const line of stdout.split('\n')) {
    const m = line.match(/^WDP_([A-Z]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim();
  }

  const dockerVersion = vars.DV === 'NOTFOUND' ? '' : vars.DV;
  const composeVersion = vars.CV === 'NOTFOUND' ? '' : vars.CV;
  const dockerCli = vars.DC || '';
  const podmanPkg = parseInt(vars.PP, 10) || 0;
  const composeProbe = vars.CP || '';
  const osId = vars.OID || '';
  const osCodename = vars.OCN || '';

  const isPodman = /podman/i.test(dockerCli)
    || /podman/i.test(composeProbe)
    || podmanPkg > 0;

  const dockerMajor = parseFloat(dockerVersion) || 0;
  const composeMajor = parseFloat(composeVersion) || 0;
  const dockerFound = dockerMajor > 0 || (dockerVersion && dockerVersion !== 'NOTFOUND');
  const composeFound = composeMajor > 0 || (composeVersion && composeVersion !== 'NOTFOUND');
  const composeProgressOk = !/unknown flag/i.test(composeProbe);

  const issues = [];
  let fixHint = null;

  if (!dockerFound && !isPodman) {
    issues.push('missing_docker');
    fixHint = fixHint || 'missing';
  }
  if (isPodman) {
    issues.push('podman_shim');
    fixHint = 'podman';
  }
  if (dockerFound && dockerMajor > 0 && dockerMajor < MIN_DOCKER_MAJOR) {
    issues.push('docker_too_old');
    fixHint = fixHint || 'docker_old';
  }
  if (!composeFound) {
    issues.push('missing_compose');
    fixHint = fixHint || 'missing_compose';
  } else if (composeMajor > 0 && composeMajor < MIN_COMPOSE_MAJOR) {
    issues.push('compose_too_old');
    fixHint = fixHint || 'compose_old';
  }
  if (composeFound && !composeProgressOk) {
    issues.push('compose_no_progress');
    fixHint = fixHint || 'compose_old';
  }

  const ok = issues.length === 0;

  let detail;
  if (!dockerFound && !isPodman) {
    detail = 'Docker not found on the remote host. Install Docker Engine 24+ and Compose v2.';
  } else if (isPodman) {
    detail = `Podman or podman-docker detected (${dockerCli || 'shim installed'}). WDP needs real Docker CE.`;
  } else if (!ok) {
    detail = `Docker ${dockerVersion || '?'} / Compose ${composeVersion || '?'} — need Docker ≥ ${MIN_DOCKER_MAJOR} and Compose ≥ ${MIN_COMPOSE_MAJOR}`;
    if (!composeProgressOk) detail += ' (Compose does not support --progress plain)';
  } else {
    detail = `Docker ${dockerVersion} / Compose ${composeVersion}`;
  }

  return {
    ok,
    dockerVersion: dockerVersion || null,
    composeVersion: composeVersion || null,
    isPodman,
    composeProgressOk,
    podmanPackageInstalled: podmanPkg > 0,
    osId,
    osCodename,
    targetOS: mapRemoteOsToTarget(osId, osCodename),
    issues,
    fixHint,
    detail,
    troubleshootingDoc: TROUBLESHOOTING_DOC,
    canInstall: !ok && (osId === 'ubuntu' || osId === 'debian'),
  };
}

function mapRemoteOsToTarget(osId, codename) {
  if (osId === 'debian') return 'debian-12';
  if (osId === 'ubuntu') {
    if (codename === 'noble') return 'ubuntu-24.04';
    if (codename === 'jammy') return 'ubuntu-22.04';
    if (codename === 'focal') return 'ubuntu-22.04';
    return 'ubuntu-24.04';
  }
  return 'ubuntu-24.04';
}

async function installDockerViaSsh(sshCfg, targetOS, log = () => {}) {
  const script = buildDockerInstallBash(targetOS);
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  log('[WDP] Installing Docker CE on remote host (may take several minutes)...');
  const { code, stderr } = await sshExec(sshCfg, `echo ${JSON.stringify(b64)} | base64 -d | bash`);
  if (code !== 0) {
    const tail = stderr ? stderr.trim().split('\n').slice(-5).join(' ') : '';
    throw new Error(`Docker install failed on remote host${tail ? `: ${tail}` : ''}`);
  }
  log('[WDP] Docker install script finished. Verifying...');
  const status = await inspectRemoteDocker(sshCfg);
  if (!status.ok) {
    throw new Error(`Docker install finished but checks still fail: ${status.detail}`);
  }
  log(`[WDP] ✓ Remote Docker ready: ${status.detail}`);
  return status;
}

module.exports = {
  buildDockerInstallBash,
  inspectRemoteDocker,
  installDockerViaSsh,
  mapRemoteOsToTarget,
  TROUBLESHOOTING_DOC,
};
