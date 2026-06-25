<script>
  import { get } from 'svelte/store';
  import { wizardStore } from '$lib/wizardStore.js';
  import { stepValid } from '$lib/stepValid.js';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import ProductLearnMore from '$lib/components/ProductLearnMore.svelte';
  import { SCANNER_LINKS } from '$lib/productLinks.js';
  import { _ } from 'svelte-i18n';

  const s7 = get(wizardStore).step7;
  let npmAudit       = s7.npmAudit       ?? true;
  let osvScanner     = s7.osvScanner     ?? false;
  let socketCli      = s7.socketCli      ?? false;
  let gitleaks       = s7.gitleaks       ?? false;
  let trivy          = s7.trivy          ?? false;
  let grype          = s7.grype          ?? false;
  let dockerScout    = s7.dockerScout    ?? false;
  let blockOnCritical = s7.blockOnCritical ?? false;
  let scanOnDeploy    = s7.scanOnDeploy    ?? true;

  const SCANNERS = [
    {
      key: 'npmAudit',
      label: 'npm audit',
      icon: '📦',
      desc: 'Checks your Node.js dependencies against the npm advisory database.',
      tooltip: { title: 'npm audit', body: 'Runs npm audit --audit-level=moderate against your project\'s node_modules. Always included and always enabled — cannot be disabled.', defaultHint: 'Always on' },
      disabled: true
    },
    {
      key: 'osvScanner',
      label: 'OSV-Scanner',
      icon: '🔍',
      desc: 'Google\'s open-source vulnerability scanner. Checks dependencies against the OSV database.',
      tooltip: { title: 'OSV-Scanner', body: 'Scans package-lock.json against the Open Source Vulnerabilities (OSV) database maintained by Google. Catches vulnerabilities not always present in the npm advisory DB.', defaultHint: 'Recommended' }
    },
    {
      key: 'socketCli',
      label: 'Socket CLI',
      icon: '🔌',
      desc: 'Detects supply-chain attacks, malicious packages, and suspicious package changes.',
      tooltip: { title: 'Socket CLI', body: 'Socket.dev\'s CLI checks your dependencies for known supply-chain threats, typosquatting, and suspicious author/maintainer changes — catches things CVE databases miss.', defaultHint: 'Recommended — especially for supply chain attack prevention' }
    },
    {
      key: 'gitleaks',
      label: 'Gitleaks',
      icon: '🔑',
      desc: 'Scans git history and staged files for hardcoded secrets, API keys, and passwords.',
      tooltip: { title: 'Gitleaks', body: 'Detects hardcoded credentials, tokens, and API keys committed to the repository — including in git history.', defaultHint: 'Recommended', gotcha: 'Gitleaks will fail the pipeline if it finds secrets. Fix them with git-filter-repo before deploying — do not just add them to .gitleaksignore without reviewing each finding.' }
    },
    {
      key: 'trivy',
      label: 'Trivy',
      icon: '🛡️',
      desc: 'Scans the built Docker image for OS-level and language-level CVEs.',
      tooltip: { title: 'Trivy', body: 'Aqua Security\'s Trivy scans the final Docker image layers for CVEs in both OS packages (Alpine, Debian) and application dependencies.', defaultHint: 'Recommended for production images' }
    },
    {
      key: 'grype',
      label: 'Grype + Syft',
      icon: '🔬',
      desc: 'Generates an SBOM with Syft then scans it for vulnerabilities with Grype.',
      tooltip: { title: 'Grype + Syft', body: 'Syft generates a Software Bill of Materials (SBOM) for the Docker image. Grype then scans that SBOM for known vulnerabilities. The SBOM is saved as a build artefact.', defaultHint: 'Recommended — SBOM is a useful compliance artefact' }
    },
    {
      key: 'dockerScout',
      label: 'Docker Scout',
      icon: '🐳',
      desc: 'Docker\'s native image vulnerability scanner. Requires Docker Hub login.',
      tooltip: { title: 'Docker Scout', body: 'Docker Scout analyses the image and compares it against Docker\'s own vulnerability database. Useful if you push to Docker Hub. Requires a Docker Hub account and CLI login.', defaultHint: 'Optional — requires Docker Hub authentication', gotcha: 'Requires docker login inside the pipeline runner. Configure Docker Hub credentials as environment variables before enabling.' }
    }
  ];

  $: {
    stepValid.set(true);
    wizardStore.setStep(7, { npmAudit, osvScanner, socketCli, gitleaks, trivy, grype, dockerScout, blockOnCritical, scanOnDeploy });
  }

  const values = { npmAudit, osvScanner, socketCli, gitleaks, trivy, grype, dockerScout };

  function getVal(key) {
    switch (key) {
      case 'npmAudit':    return npmAudit;
      case 'osvScanner':  return osvScanner;
      case 'socketCli':   return socketCli;
      case 'gitleaks':    return gitleaks;
      case 'trivy':       return trivy;
      case 'grype':       return grype;
      case 'dockerScout': return dockerScout;
    }
    return false;
  }

  function setVal(key, val) {
    switch (key) {
      case 'osvScanner':  osvScanner  = val; break;
      case 'socketCli':   socketCli   = val; break;
      case 'gitleaks':    gitleaks    = val; break;
      case 'trivy':       trivy       = val; break;
      case 'grype':       grype       = val; break;
      case 'dockerScout': dockerScout = val; break;
    }
  }
</script>

<h2 class="text-xl font-semibold text-white mb-1">{$_('wizard.step7.title')}</h2>
<p class="text-gray-400 text-sm mb-8">
  {$_('wizard.step7.subtitle')}
</p>

<div class="space-y-3">
  {#each SCANNERS as s}
    {@const checked = getVal(s.key)}
    <div class="flex items-start gap-4 px-4 py-4 rounded-xl border transition-colors
      {checked ? 'border-indigo-600/40 bg-indigo-950/15' : 'border-gray-700 bg-gray-800/30'}
      {s.disabled ? 'opacity-70' : ''}">
      <input
        type="checkbox"
        checked={checked}
        disabled={s.disabled}
        onchange={(e) => { if (!s.disabled) setVal(s.key, e.target.checked); }}
        class="mt-0.5 w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-600
               focus:ring-indigo-500 shrink-0
               {s.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}"
      />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="text-base leading-none">{s.icon}</span>
          <p class="text-sm font-medium text-white">{s.label}</p>
          {#if s.disabled}
            <span class="text-xs text-gray-500 font-normal ml-1">({$_('wizard.step7.alwaysOn')})</span>
          {/if}
          <Tooltip
            title={$_('wizard.step7.tooltip.' + s.key + '.title')}
            body={$_('wizard.step7.tooltip.' + s.key + '.body')}
            defaultHint={$_('wizard.step7.tooltip.' + s.key + '.defaultHint')}
            gotcha={$_('wizard.step7.tooltip.' + s.key + '.gotcha')}
          />
          <ProductLearnMore href={SCANNER_LINKS[s.key]} />
        </div>
        <p class="text-xs text-gray-400 mt-0.5">{$_('wizard.step7.scannerDesc.' + s.key)}</p>
      </div>
    </div>
  {/each}
</div>

<!-- Block on critical -->
<div class="mt-6 border border-gray-700 rounded-xl p-5
  {blockOnCritical ? 'border-red-700/40 bg-red-950/10' : ''}">
  <div class="flex items-start gap-4">
    <button
      type="button"
      onclick={() => { blockOnCritical = !blockOnCritical; }}
      class="relative rounded-full transition-colors shrink-0 focus:outline-none
             focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950
             {blockOnCritical ? 'bg-red-600' : 'bg-gray-700'}"
      aria-pressed={blockOnCritical}
      style="width: 40px; height: 22px; margin-top: 2px;"
    >
      <span class="absolute top-0.5 left-0.5 rounded-full bg-white transition-transform
                   {blockOnCritical ? 'translate-x-4' : 'translate-x-0'}"
            style="width: 18px; height: 18px;"></span>
    </button>
    <div>
      <div class="flex items-center">
        <p class="text-sm font-medium text-white">{$_('wizard.step7.blockOnCriticalLabel')}</p>
        <Tooltip
          title={$_('wizard.step7.tooltip.blockOnCritical.title')}
          body={$_('wizard.step7.tooltip.blockOnCritical.body')}
          gotcha={$_('wizard.step7.tooltip.blockOnCritical.gotcha')}
        />
      </div>
      <!-- svelte-ignore html_unsafe -->
      <p class="text-xs text-gray-400 mt-0.5">{@html $_('wizard.step7.blockOnCriticalDesc')}</p>
    </div>
  </div>

  <div class="flex items-start gap-3 p-4 rounded-lg border border-gray-700 bg-gray-800/40">
    <button type="button" role="switch" aria-checked={scanOnDeploy}
      onclick={() => { scanOnDeploy = !scanOnDeploy; }}
      class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors mt-0.5
             {scanOnDeploy ? 'bg-indigo-600' : 'bg-gray-700'}">
      <span class="inline-block h-4 w-4 transform rounded-full bg-white transition translate-x-0.5 mt-0.5
                   {scanOnDeploy ? 'translate-x-4' : 'translate-x-0'}"></span>
    </button>
    <div>
      <p class="text-sm font-medium text-white">{$_('wizard.step7.scanOnDeployLabel')}</p>
      <p class="text-xs text-gray-400 mt-0.5">{$_('wizard.step7.scanOnDeployDesc')}</p>
    </div>
  </div>
</div>
