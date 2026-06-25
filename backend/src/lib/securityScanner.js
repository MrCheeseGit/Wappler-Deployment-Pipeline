'use strict';

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

/**
 * Run all enabled security scanners from the Step 7 wizard config.
 *
 * @param {object}   step7       - wizard step7 config  { npmAudit, osvScanner, ... }
 * @param {string}   projectPath - absolute project root directory
 * @param {function} logFn       - (line: string, stream?: 'stdout'|'stderr') => void
 * @returns {Promise<ScanResult[]>}
 */
async function runScanners(step7, projectPath, logFn) {
  if (!step7) return [];

  const PIPELINE = [
    { key: 'npmAudit',    label: 'npm audit',    icon: '📦', fn: scanNpmAudit },
    { key: 'osvScanner',  label: 'OSV-Scanner',  icon: '🔍', fn: scanOsvScanner },
    { key: 'socketCli',   label: 'Socket CLI',   icon: '🔌', fn: scanSocketCli },
    { key: 'gitleaks',    label: 'Gitleaks',     icon: '🔑', fn: scanGitleaks },
    { key: 'trivy',       label: 'Trivy',        icon: '🛡️',  fn: scanTrivy },
    { key: 'grype',       label: 'Grype',        icon: '🔬', fn: scanGrype },
    { key: 'dockerScout', label: 'Docker Scout', icon: '🐳', fn: scanDockerScout },
  ];

  const results = [];

  for (const s of PIPELINE) {
    if (!step7[s.key]) continue;

    log(`[Security] ── ${s.icon}  ${s.label} ──────────────────────────────────`);

    try {
      const r = await s.fn(projectPath, log);
      results.push({ scanner: s.key, label: s.label, icon: s.icon, ...r });

      if (r.status === 'skipped') {
        log(`[Security] ${s.label}: ⏭  Skipped — ${r.skipReason}`);
      } else if (r.status === 'pass') {
        log(`[Security] ${s.label}: ✓  No issues found`);
      } else if (r.status === 'error') {
        log(`[Security] ${s.label}: ✗  Error — see details`, 'stderr');
      } else {
        const counts = summarizeCounts(r.findings);
        log(
          `[Security] ${s.label}: ${r.status === 'fail' ? '✗  FAIL' : '⚠  WARN'} — ${counts}`,
          r.status === 'fail' ? 'stderr' : 'stdout',
        );
      }
    } catch (err) {
      log(`[Security] ${s.label}: ✗  ERROR — ${err.message}`, 'stderr');
      results.push({
        scanner:    s.key,
        label:      s.label,
        icon:       s.icon,
        status:     'error',
        findings:   [],
        rawOutput:  err.message,
      });
    }

    log('');
  }

  return results;

  function log(line, stream = 'stdout') {
    if (logFn) logFn(line, stream);
  }
}

// ── Individual scanners ────────────────────────────────────────────────────────

async function scanNpmAudit(projectPath) {
  if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
    return skip('No package.json found');
  }

  const lockfile  = path.join(projectPath, 'package-lock.json');
  const yarnlock  = path.join(projectPath, 'yarn.lock');
  if (!fs.existsSync(lockfile) && !fs.existsSync(yarnlock)) {
    return skip('No lockfile found — run: npm i --package-lock-only');
  }

  // npm audit exits 1 when vulnerabilities exist — use ignoreExitCode
  const { all: raw, stdout: rawJson } = await runCmd('npm', ['audit', '--json'], projectPath, true);

  let json;
  try { json = JSON.parse(rawJson); } catch {
    const errMatch = raw.match(/npm error (.+)/i);
    return { status: 'error', findings: [], rawOutput: raw, errorMessage: errMatch?.[1] };
  }

  const findings = [];
  for (const [name, vuln] of Object.entries(json.vulnerabilities || {})) {
    // fixAvailable is { name, version } for the TOP-LEVEL package to install.
    // For transitive deps, fixAvailable.name differs from name (the vulnerable pkg).
    // fixAvailable === true (boolean) means fix exists but requires a semver-major/breaking change.
    const fixAvail     = typeof vuln.fixAvailable === 'object' ? vuln.fixAvailable : null;
    const fixForce     = vuln.fixAvailable === true; // breaking-change fix only
    const fixPkg       = fixAvail?.name     || name;   // package to `npm install`
    const fixVersion   = fixAvail?.version;            // version to install
    const isTransitive = !vuln.isDirect && fixPkg !== name;

    findings.push({
      id:            `npm::${name}::${vuln.severity}`,
      severity:      normSeverity(vuln.severity),
      title:         `${name} — ${vuln.severity} severity`,
      pkg:           fixPkg,         // package that npm install should target
      vulnerablePkg: name,           // the actual vulnerable package (for display)
      fixable:       !!vuln.fixAvailable,
      fixedIn:       fixVersion,
      fixForce,      // true = only fixable via npm audit fix --force (breaking change)
      detail:        isTransitive
        ? `Transitive dependency — fix by upgrading ${fixPkg}`
        : vuln.isDirect ? 'Direct dependency' : 'Transitive dependency',
    });
  }

  return {
    status:   determineStatus(findings),
    findings,
    rawOutput: raw,
    meta:     json.metadata?.vulnerabilities,
  };
}

async function scanOsvScanner(projectPath) {
  const lockfile = path.join(projectPath, 'package-lock.json');
  const yarnlock = path.join(projectPath, 'yarn.lock');

  if (!fs.existsSync(lockfile) && !fs.existsSync(yarnlock)) {
    return skip('No lockfile found (package-lock.json or yarn.lock)');
  }
  if (!await cmdExists('osv-scanner')) {
    return skip('osv-scanner not installed — install from https://github.com/google/osv-scanner/releases');
  }

  const lockArg = fs.existsSync(lockfile) ? lockfile : yarnlock;
  const { all: rawAll, stdout: rawJson } = await runCmd(
    'osv-scanner',
    ['--lockfile', lockArg, '--format', 'json'],
    projectPath,
    true,
  );

  let json;
  try { json = JSON.parse(rawJson); } catch {
    return { status: 'error', findings: [], rawOutput: rawAll };
  }

  const findings = [];
  for (const result of json.results || []) {
    for (const pkg of result.packages || []) {
      for (const vuln of pkg.vulnerabilities || []) {
        const sev   = normSeverity(vuln.database_specific?.severity);
        const cveId = vuln.aliases?.find(a => a.startsWith('CVE-')) || vuln.id;

        // Extract fixed version from affected[].ranges[].events[].fixed
        let fixedIn;
        for (const affected of vuln.affected || []) {
          if (affected.package?.name !== pkg.package.name) continue;
          for (const range of affected.ranges || []) {
            const fixEvent = range.events?.find(e => e.fixed);
            if (fixEvent) { fixedIn = fixEvent.fixed; break; }
          }
          if (fixedIn) break;
        }

        findings.push({
          id:       `osv::${vuln.id}::${pkg.package.name}`,
          severity: sev,
          title:    `${pkg.package.name} — ${cveId}`,
          pkg:      pkg.package.name,
          version:  pkg.package.version,
          fixedIn,
          fixable:  !!fixedIn,
          detail:   vuln.summary || vuln.id,
          url:      `https://osv.dev/vulnerability/${vuln.id}`,
        });
      }
    }
  }

  return { status: determineStatus(findings), findings, rawOutput: rawAll };
}

async function scanSocketCli(projectPath) {
  if (!fs.existsSync(path.join(projectPath, 'package.json'))) {
    return skip('No package.json found');
  }
  if (!await cmdExists('socket')) {
    return skip('socket CLI not installed — run: sudo npm install -g @socketsecurity/cli');
  }

  const { all: raw } = await runCmd('socket', ['scan', 'create', '--dry-run', '.'], projectPath, true);

  // Parse text output — Socket CLI uses plain text with severity markers
  const findings = [];
  const seen = new Set();
  for (const line of raw.split('\n')) {
    const lower = line.toLowerCase();
    if (!lower.includes('critical') && !lower.includes('high') && !lower.includes('medium')) continue;
    const trimmed = line.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);

    const sev = lower.includes('critical') ? 'CRITICAL'
              : lower.includes('high')     ? 'HIGH'
              :                              'MEDIUM';
    findings.push({
      id:       `socket::${Buffer.from(trimmed).toString('base64').slice(0, 20)}`,
      severity: sev,
      title:    trimmed.slice(0, 120),
      detail:   trimmed,
    });
  }

  return { status: determineStatus(findings), findings, rawOutput: raw };
}

async function scanGitleaks(projectPath) {
  if (!await cmdExists('gitleaks')) {
    return skip('gitleaks not installed — install from https://github.com/gitleaks/gitleaks/releases');
  }

  const tmpReport = path.join(os.tmpdir(), `gitleaks-${Date.now()}.json`);
  const hasGit    = fs.existsSync(path.join(projectPath, '.git'));

  const args = [
    'detect',
    '--source', '.',
    '--report-format', 'json',
    '--report-path', tmpReport,
    '--redact',
  ];
  if (!hasGit) args.push('--no-git');

  // gitleaks exits 1 when leaks found, 2 on error
  await runCmd('gitleaks', args, projectPath, true);

  let findings = [];
  try {
    const raw  = fs.readFileSync(tmpReport, 'utf8');
    const data = JSON.parse(raw);
    findings   = (Array.isArray(data) ? data : []).map(leak => ({
      id:       `gitleaks::${leak.Fingerprint || (leak.RuleID + leak.File + leak.StartLine)}`,
      severity: 'HIGH',
      title:    `${leak.Description || leak.RuleID} in ${leak.File}`,
      pkg:      leak.RuleID,
      detail:   `${leak.File}:${leak.StartLine}` + (leak.Commit ? ` (commit ${leak.Commit.slice(0, 7)})` : ''),
    }));
  } catch { /* report file empty or not created = no leaks */ }

  try { fs.unlinkSync(tmpReport); } catch {}

  return { status: determineStatus(findings), findings };
}

async function scanTrivy(projectPath) {
  if (!await cmdExists('trivy')) {
    return skip('trivy not installed — install from https://trivy.dev/getting-started/installation/');
  }

  const { all: rawAll, stdout: rawJson } = await runCmd(
    'trivy',
    ['fs', '--format', 'json', '--quiet', '--no-progress', '.'],
    projectPath,
    true,
  );

  let json;
  try { json = JSON.parse(rawJson); } catch {
    return { status: 'error', findings: [], rawOutput: rawAll };
  }

  const findings = [];
  for (const result of json.Results || []) {
    for (const vuln of result.Vulnerabilities || []) {
      findings.push({
        id:       `trivy::${vuln.VulnerabilityID}::${vuln.PkgName}`,
        severity: normSeverity(vuln.Severity),
        title:    `${vuln.PkgName} — ${vuln.VulnerabilityID}`,
        pkg:      vuln.PkgName,
        version:  vuln.InstalledVersion,
        fixedIn:  vuln.FixedVersion || undefined,
        detail:   (vuln.Title || vuln.Description || '').slice(0, 160),
        url:      vuln.PrimaryURL,
      });
    }
  }

  return { status: determineStatus(findings), findings, rawOutput: rawAll };
}

async function scanGrype(projectPath) {
  if (!await cmdExists('grype')) {
    return skip('grype not installed — install from https://github.com/anchore/grype#installation');
  }

  const { all: rawAll, stdout: rawJson } = await runCmd('grype', ['dir:.', '-o', 'json', '-q'], projectPath, true);

  let json;
  try { json = JSON.parse(rawJson); } catch {
    return { status: 'error', findings: [], rawOutput: rawAll };
  }

  const findings = (json.matches || []).map(m => ({
    id:       `grype::${m.vulnerability.id}::${m.artifact.name}`,
    severity: normSeverity(m.vulnerability.severity),
    title:    `${m.artifact.name} — ${m.vulnerability.id}`,
    pkg:      m.artifact.name,
    version:  m.artifact.version,
    fixedIn:  m.vulnerability.fix?.versions?.[0],
    detail:   (m.vulnerability.description || '').slice(0, 160),
    url:      m.vulnerability.urls?.[0],
  }));

  return { status: determineStatus(findings), findings, rawOutput: raw };
}

async function scanDockerScout(projectPath) {
  if (!await cmdExists('docker')) return skip('docker not found');

  // Check if the scout plugin exists
  const helpOut = await runCmd('docker', ['scout', '--help'], projectPath, true).catch(() => ({ all: '', stdout: '' }));
  if (!helpOut.all || helpOut.all.includes('Usage:  docker [OPTIONS]')) {
    return skip('Docker Scout CLI plugin not installed — run: docker plugin install dockerscout/scout');
  }

  return skip(
    'Docker Scout requires a pre-built image. Build your image first, then run: docker scout cves <image>',
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function skip(reason) {
  return { status: 'skipped', skipReason: reason, findings: [] };
}

function normSeverity(raw) {
  const s = (raw || '').toString().toUpperCase();
  if (s === 'CRITICAL')              return 'CRITICAL';
  if (s === 'HIGH')                  return 'HIGH';
  if (s === 'MODERATE' || s === 'MEDIUM') return 'MEDIUM';
  if (s === 'LOW')                   return 'LOW';
  return 'INFO';
}

function determineStatus(findings) {
  if (!findings.length)                                    return 'pass';
  if (findings.some(f => f.severity === 'CRITICAL'))       return 'fail';
  if (findings.some(f => f.severity === 'HIGH'))           return 'warn';
  return 'warn';
}

function summarizeCounts(findings) {
  const counts = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  return SEVERITY_ORDER.filter(s => counts[s]).map(s => `${counts[s]} ${s}`).join(', ') || 'no findings';
}

function cmdExists(cmd) {
  return new Promise(resolve => {
    const p = spawn('which', [cmd], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', code => resolve(code === 0));
  });
}

function runCmd(command, args, cwd, ignoreExitCode = false) {
  const { dockerCliEnv } = require('./dockerHost');
  const spawnEnv = command === 'docker' ? dockerCliEnv() : process.env;
  return new Promise((resolve, reject) => {
    const allChunks    = [];   // stdout + stderr interleaved (for error messages)
    const stdoutChunks = [];   // stdout only (for JSON parsing)
    const proc = spawn(command, args, { cwd, env: spawnEnv, stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout.on('data', d => { allChunks.push(d); stdoutChunks.push(d); });
    proc.stderr.on('data', d => { allChunks.push(d); });

    proc.on('error', err => {
      if (err.code === 'ENOENT') {
        if (ignoreExitCode) resolve({ all: '', stdout: '' });
        else reject(new Error(`Command not found: ${command}`));
      } else {
        reject(err);
      }
    });

    proc.on('close', code => {
      const all    = Buffer.concat(allChunks).toString('utf8');
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      if (code !== 0 && !ignoreExitCode) {
        reject(new Error(`${command} exited with code ${code}: ${all.slice(0, 300)}`));
      } else {
        resolve({ all, stdout });
      }
    });
  });
}

module.exports = { runScanners, SEVERITY_ORDER, summarizeCounts };
