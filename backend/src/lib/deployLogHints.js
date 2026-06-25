'use strict';

const TROUBLESHOOTING_DOC = 'application_documentation/troubleshooting-deploy-server.md';

const PATTERNS = [
  {
    re: /unknown flag:\s*--progress/i,
    hint: 'Remote Docker Compose is too old or missing. WDP runs `docker compose --progress plain`. Install Docker CE and docker-compose-plugin v2 on the server.',
    fixHint: 'compose_old',
  },
  {
    re: /podman/i,
    hint: 'The remote `docker` command may be Podman (podman-docker). Remove podman-docker and install Docker CE. See troubleshooting doc.',
    fixHint: 'podman',
  },
  {
    re: /docker:\s*command not found|Cannot connect to the Docker daemon/i,
    hint: 'Docker is not running or not installed on the remote server. Use Server → Remote readiness or install Docker from the profile.',
    fixHint: 'missing',
  },
  {
    re: /held broken packages|unable to locate package docker-ce/i,
    hint: 'apt could not install Docker CE. Check repository codename (noble on Ubuntu 24.04) and remove package holds. See troubleshooting doc.',
    fixHint: 'apt_docker',
  },
  {
    re: /client version 1\.\d+ is too old/i,
    hint: 'Traefik or another tool cannot talk to Docker Engine 29+. Regenerate deployment files (Step 8) for Traefik v3.6.7+.',
    fixHint: 'traefik_docker29',
  },
];

/**
 * Return extra hint lines to append after a failed remote command, if stderr/stdout matches.
 */
function hintsForDeployOutput(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const { re, hint } of PATTERNS) {
    if (re.test(text)) {
      out.push(`[WDP hint] ${hint}`);
      out.push(`[WDP hint] See ${TROUBLESHOOTING_DOC} in the WDP folder.`);
      break;
    }
  }
  return out;
}

module.exports = { hintsForDeployOutput, TROUBLESHOOTING_DOC };
