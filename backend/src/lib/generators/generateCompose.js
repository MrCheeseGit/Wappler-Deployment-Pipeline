'use strict';

const { TRAEFIK_IMAGE } = require('../traefikCompat');
const { traefikHostRuleEnv } = require('../traefikHosts');
const {
  isExternalTraefik,
  isBundledTraefik,
  getTraefikNetwork,
} = require('../traefikDeploy');
const {
  shouldDeployRedisContainer,
  buildRedisServerCommand,
  getRedisNetwork,
  sanitizeDockerNetworkName,
} = require('../redisDeploy');

/** Docker image repository names must be lowercase (Docker reference rules). */
function dockerImageSlug(name) {
  return String(name || 'default')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'default';
}

/**
 * Generates docker-compose.deploy.yml content from the wizard profile config.
 * @param {object} config — the full wizard store snapshot
 * @returns {string}
 */
function generateCompose(config) {
  const step1  = config.step1  || {};
  const step3  = config.step3  || {};
  const step4  = config.step4  || {};
  const step5  = config.step5  || {};
  const step6  = config.step6  || {};
  const profile = config.activeProfile || 'default';
  const projectName = dockerImageSlug(step1.detectedName || 'app');
  const profileSlug = dockerImageSlug(profile);

  const services = {};
  const networks = { internal: { driver: 'bridge' } };
  const volumes  = { uploads: null };

  const appNetworks = ['internal'];
  const appDependsOn = [];
  const isLocal = step4.hostingTarget === 'local';

  // ── Traefik ──────────────────────────────────────────────────────
  const traefikCfg = step5.addons?.traefik;
  const traefikEnabled = traefikCfg?.enabled;
  const traefikExternal = traefikEnabled && !isLocal && isExternalTraefik(traefikCfg);
  const traefikBundledRemote = traefikEnabled && !isLocal && isBundledTraefik(traefikCfg);
  if (traefikEnabled && !isLocal) {
    const traefikNetwork = getTraefikNetwork(traefikCfg);
    networks[traefikNetwork] = { external: true };
    appNetworks.push(traefikNetwork);
  }

  // ── Database service ─────────────────────────────────────────────────────
  const skipDb = step3.skipDb;
  const dbManaged = !skipDb && step3.dbLocation === 'managed';

  if (dbManaged) {
    appDependsOn.push('db');
    if (step3.dbType === 'postgres' || !step3.dbType) {
      volumes['db_data'] = null;
      services['db'] = {
        _type: 'postgres',
        image: 'postgres:16-alpine',
        restart: 'unless-stopped',
        environment: [
          'POSTGRES_DB=${DB_NAME}',
          'POSTGRES_USER=${DB_USER}',
          'POSTGRES_PASSWORD=${DB_PASSWORD}',
        ],
        volumes: ['db_data:/var/lib/postgresql/data'],
        networks: ['internal'],
      };
    } else if (step3.dbType === 'mysql') {
      volumes['db_data'] = null;
      services['db'] = {
        _type: 'mysql',
        image: 'mysql:8.0',
        restart: 'unless-stopped',
        environment: [
          'MYSQL_DATABASE=${DB_NAME}',
          'MYSQL_USER=${DB_USER}',
          'MYSQL_PASSWORD=${DB_PASSWORD}',
          'MYSQL_ROOT_PASSWORD=${DB_ROOT_PASSWORD}',
        ],
        volumes: ['db_data:/var/lib/mysql'],
        networks: ['internal'],
      };
    }
  }

  // ── Add-on services ───────────────────────────────────────────────────────
  const addons = step5.addons || {};

  if (shouldDeployRedisContainer(addons.redis)) {
    volumes['redis_data'] = null;
    const redisService = {
      image: 'redis:7-alpine',
      restart: 'unless-stopped',
      command: buildRedisServerCommand(addons.redis),
      volumes: ['redis_data:/data'],
      networks: ['internal'],
    };
    services['redis'] = redisService;
    appDependsOn.push('redis');
  }

  const redisExternalNetwork = getRedisNetwork(addons.redis);
  if (redisExternalNetwork) {
    const netName = sanitizeDockerNetworkName(redisExternalNetwork);
    if (netName) {
      networks[netName] = { external: true };
      if (!appNetworks.includes(netName)) appNetworks.push(netName);
    }
  }

  if (addons.minio?.enabled) {
    volumes['minio_data'] = null;
    services['minio'] = {
      image: 'minio/minio:latest',
      restart: 'unless-stopped',
      command: 'server /data --console-address ":9001"',
      environment: [
        'MINIO_ROOT_USER=${MINIO_ROOT_USER}',
        'MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}',
      ],
      volumes: ['minio_data:/data'],
      networks: ['internal'],
      ports: ['9001:9001'],
    };
  }

  if (addons.portainer?.enabled) {
    volumes['portainer_data'] = null;
    services['portainer'] = {
      image: 'portainer/portainer-ce:latest',
      restart: 'unless-stopped',
      volumes: ['/var/run/docker.sock:/var/run/docker.sock', 'portainer_data:/data'],
      networks: ['internal'],
      ports: ['9443:9443'],
    };
  }

  if (addons.uptimekuma?.enabled) {
    volumes['kuma_data'] = null;
    services['uptime-kuma'] = {
      image: 'louislam/uptime-kuma:latest',
      restart: 'unless-stopped',
      volumes: ['kuma_data:/app/data'],
      networks: ['internal'],
      ports: ['3001:3001'],
    };
  }

  if (addons.plausible?.enabled) {
    volumes['plausible_data'] = null;
    services['plausible'] = {
      image: 'ghcr.io/plausible/community-edition:v2',
      restart: 'unless-stopped',
      environment: [
        'BASE_URL=${PLAUSIBLE_BASE_URL}',
        'SECRET_KEY_BASE=${PLAUSIBLE_SECRET_KEY_BASE}',
      ],
      volumes: ['plausible_data:/var/lib/plausible'],
      networks: ['internal'],
    };
  }

  if (addons.mailpit?.enabled) {
    services['mailpit'] = {
      image: 'axllent/mailpit:latest',
      restart: 'unless-stopped',
      networks: ['internal'],
      ports: ['8025:8025'],
    };
  }

  if (addons.n8n?.enabled) {
    volumes['n8n_data'] = null;
    services['n8n'] = {
      image: 'n8nio/n8n:latest',
      restart: 'unless-stopped',
      environment: ['N8N_BASIC_AUTH_ACTIVE=true', 'N8N_BASIC_AUTH_USER=${N8N_USER}', 'N8N_BASIC_AUTH_PASSWORD=${N8N_PASSWORD}'],
      volumes: ['n8n_data:/home/node/.n8n'],
      networks: ['internal'],
    };
  }

  if (addons.restic?.enabled) {
    services['restic'] = {
      image: 'mazzolino/restic:latest',
      restart: 'unless-stopped',
      environment: ['RESTIC_REPOSITORY=${RESTIC_REPOSITORY}', 'RESTIC_PASSWORD=${RESTIC_PASSWORD}', 'BACKUP_CRON=${BACKUP_CRON:-0 2 * * *}'],
      volumes: ['uploads:/mnt/uploads:ro'],
      networks: ['internal'],
    };
  }

  // ── Traefik reverse-proxy service (bundled only — not when using existing server Traefik) ──
  if (traefikBundledRemote || (traefikEnabled && isLocal)) {
    const certResolver    = traefikCfg.certResolver    || 'leresolver';
    const challengeType   = traefikCfg.challengeType   || 'http';  // 'http' | 'tls'
    const traefikNetwork  = getTraefikNetwork(traefikCfg);

    volumes['traefik_letsencrypt'] = null;
    const traefikCmd = [
      '--api.insecure=false',
      '--providers.docker=true',
      '--providers.docker.exposedbydefault=false',
      '--providers.docker.allowEmptyServices=true',
      `--providers.docker.network=${traefikNetwork}`,
      '--entrypoints.web.address=:80',
      '--entrypoints.websecure.address=:443',
      `--certificatesresolvers.${certResolver}.acme.email=\${ACME_EMAIL}`,
      `--certificatesresolvers.${certResolver}.acme.storage=/letsencrypt/acme.json`,
    ];
    if (challengeType === 'tls') {
      traefikCmd.push(
        '--entrypoints.web.http.redirections.entrypoint.to=websecure',
        '--entrypoints.web.http.redirections.entrypoint.scheme=https',
        `--certificatesresolvers.${certResolver}.acme.tlschallenge=true`,
      );
    } else {
      // No entrypoint-level HTTP→HTTPS redirect — it breaks Let's Encrypt HTTP-01 on :80.
      traefikCmd.push(
        `--certificatesresolvers.${certResolver}.acme.httpchallenge=true`,
        `--certificatesresolvers.${certResolver}.acme.httpchallenge.entrypoint=web`,
      );
    }
    if (traefikCfg.dashboard) {
      traefikCmd.push('--api.dashboard=true');
    }

    services['traefik'] = {
      image: TRAEFIK_IMAGE,
      restart: 'unless-stopped',
      command: traefikCmd,
      ports: ['80:80', '443:443'],
      volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro', 'traefik_letsencrypt:/letsencrypt'],
      networks: [traefikNetwork, 'internal'],
    };
  }

  // ── App service (assembled last so depends_on is complete) ────────────────
  const imageRef = `${projectName}-${profileSlug}:latest`;
  const appService = {
    build: {
      context: '.',
      dockerfile: `wdp/${profile}/Dockerfile.deploy`,
      cache_from: [imageRef],
    },
    image: `${projectName}-${profileSlug}:\${TAG:-latest}`,
    restart: 'unless-stopped',
    env_file: `wdp/${profile}/.env.deploy`,
    ports: ['3000:3000'],
    volumes: ['uploads:/app/uploads'],
    networks: appNetworks,
  };

  if (appDependsOn.length > 0) {
    appService.depends_on = appDependsOn;
  }

  // Traefik labels
  if (traefikEnabled) {
    // Remote production: Traefik reaches the app on the Docker network — no host :3000 bind.
    // Avoids "port already allocated" when redeploying or when another process uses 3000.
    if (!isLocal) {
      delete appService.ports;
    }
    if (isLocal) {
      // HTTP-only labels for local Traefik
      appService.labels = [
        'traefik.enable=true',
        `traefik.http.routers.${projectName}.rule=Host(\`localhost\`)`,
        `traefik.http.routers.${projectName}.entrypoints=web`,
        `traefik.http.services.${projectName}.loadbalancer.server.port=3000`,
      ];
    } else {
      const certResolver = step5.addons?.traefik?.certResolver || 'leresolver';
      const challengeType = step5.addons?.traefik?.challengeType || 'http';
      const includeWww = addons.traefik?.includeWww !== false;
      const hostRule = traefikHostRuleEnv(includeWww);
      const secureRouter = `${projectName}-secure`;
      const webRouter      = `${projectName}-web`;
      const redirectMw     = `${projectName}-redirect-https`;
      appService.labels = [
        'traefik.enable=true',
        `traefik.http.services.${projectName}.loadbalancer.server.port=3000`,
        `traefik.http.routers.${secureRouter}.rule=${hostRule}`,
        `traefik.http.routers.${secureRouter}.entrypoints=websecure`,
        `traefik.http.routers.${secureRouter}.tls=true`,
        `traefik.http.routers.${secureRouter}.tls.certresolver=${certResolver}`,
        `traefik.http.routers.${secureRouter}.service=${projectName}`,
      ];
      // Per-router redirect (not entrypoint-wide) so HTTP-01 ACME on :80 still works.
      if (challengeType !== 'tls') {
        appService.labels.push(
          `traefik.http.routers.${webRouter}.rule=${hostRule}`,
          `traefik.http.routers.${webRouter}.entrypoints=web`,
          `traefik.http.routers.${webRouter}.service=${projectName}`,
          `traefik.http.routers.${webRouter}.middlewares=${redirectMw}`,
          `traefik.http.middlewares.${redirectMw}.redirectscheme.scheme=https`,
          `traefik.http.middlewares.${redirectMw}.redirectscheme.permanent=true`,
        );
      }
    }
  }

  // Resource limits
  if (step6.memLimit || step6.cpuLimit) {
    appService.deploy = appService.deploy || {};
    if (step6.memLimit) appService.deploy.resources = { limits: { memory: step6.memLimit } };
    if (step6.cpuLimit) {
      appService.deploy.resources = appService.deploy.resources || { limits: {} };
      appService.deploy.resources.limits.cpus = step6.cpuLimit;
    }
  }

  // Horizontal scaling
  if (step6.horizontalScaling && parseInt(step6.replicas, 10) > 1) {
    appService.deploy = appService.deploy || {};
    appService.deploy.replicas = parseInt(step6.replicas, 10);
    // Cannot use ports with replicas > 1 in non-swarm mode; warn via comment
    delete appService.ports;
    appService['# NOTE'] = 'Ports removed for replica scaling — use a load balancer or Traefik.';
  }

  // SSL cert mounts (external/selfhosted DB with verify-ca or verify-full)
  if (!skipDb && ['verify-ca', 'verify-full'].includes(step3.sslMode)) {
    const sslVols = [];
    if (step3.sslCaPath)   sslVols.push(`${step3.sslCaPath}:/certs/ca.crt:ro`);
    if (step3.sslCertPath) sslVols.push(`${step3.sslCertPath}:/certs/client.crt:ro`);
    if (step3.sslKeyPath)  sslVols.push(`${step3.sslKeyPath}:/certs/client.key:ro`);
    if (sslVols.length) appService.volumes.push(...sslVols);
  }

  // Put app first
  const allServices = { app: appService, ...services };

  // ── Serialise to YAML manually (no yaml dep) ──────────────────────────────
  const traefikModeComment = traefikExternal ? 'external' : (traefikBundledRemote ? 'bundled' : '');
  return toYaml({ services: allServices, networks, volumes }, profile, projectName, traefikModeComment);
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal YAML serialiser — handles the specific structure we generate above.
// Avoids adding a yaml package dependency.
// ─────────────────────────────────────────────────────────────────────────────
function toYaml(doc, profile, projectName, traefikModeComment = '') {
  const lines = [
    `# Generated by Wappler Deployment Pipeline`,
    `# Profile: ${profile}`,
    ...(traefikModeComment ? [`# WDP traefik mode: ${traefikModeComment}`] : []),
    `# DO NOT edit manually — regenerate via the WDP wizard.`,
    `# WARNING: This file may contain environment variable references.`,
    `#          Keep the companion .env.deploy file secure and never commit it.`,
    ``,
  ];

  // services
  lines.push('services:');
  for (const [svcName, svc] of Object.entries(doc.services)) {
    lines.push(`  ${svcName}:`);
    serializeServiceFields(lines, svc, 4);
  }
  lines.push('');

  // networks
  lines.push('networks:');
  for (const [net, val] of Object.entries(doc.networks)) {
    lines.push(`  ${net}:`);
    if (val && Object.keys(val).length) {
      for (const [k, v] of Object.entries(val)) {
        lines.push(`    ${k}: ${v}`);
      }
    } else if (!val) {
      // empty object — just the key is enough
    }
  }
  lines.push('');

  // volumes
  lines.push('volumes:');
  for (const [vol, val] of Object.entries(doc.volumes)) {
    if (val === null || val === undefined) {
      lines.push(`  ${vol}:`);
    } else {
      lines.push(`  ${vol}:`);
      for (const [k, v] of Object.entries(val)) {
        lines.push(`    ${k}: ${v}`);
      }
    }
  }

  return lines.join('\n');
}

/** Quote YAML scalars that contain characters meaningful in compose YAML */
function yamlScalar(s) {
  const str = String(s);
  if (/[:#\s{}[\]&*!|>'"%@^`]/.test(str) || str === '' || str === 'true' || str === 'false' || /^\d/.test(str)) {
    return JSON.stringify(str);
  }
  return str;
}

function serializeServiceFields(lines, obj, indent) {
  const pad = ' '.repeat(indent);
  const ORDER = ['image', 'build', 'restart', 'command', 'env_file', 'environment', 'labels', 'ports', 'volumes', 'networks', 'depends_on', 'deploy'];

  const sorted = [
    ...ORDER.filter(k => k in obj),
    ...Object.keys(obj).filter(k => !ORDER.includes(k) && !k.startsWith('#') && k !== '_type'),
  ];

  for (const key of sorted) {
    const val = obj[key];
    if (val === undefined || val === null) continue;

    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      const out = typeof val === 'string' ? yamlScalar(val) : val;
      lines.push(`${pad}${key}: ${out}`);
    } else if (Array.isArray(val)) {
      lines.push(`${pad}${key}:`);
      for (const item of val) {
        lines.push(`${pad}  - ${yamlScalar(item)}`);
      }
    } else if (typeof val === 'object') {
      lines.push(`${pad}${key}:`);
      serializeServiceFields(lines, val, indent + 2);
    }
  }

  // Preserve comment-style notes
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('#')) lines.push(`${pad}${k}: ${v}`);
  }
}

module.exports = { generateCompose, dockerImageSlug };
