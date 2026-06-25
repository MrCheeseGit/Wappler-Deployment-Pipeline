# Wappler Deployment Pipeline

## Overview

Wappler is excellent for building Node.js web applications through its visual IDE, but its built-in deployment tooling offers little to no customisation — it is largely a black box. This tool is a **fully standalone, optional deployment pipeline** that runs entirely outside of Wappler. It is aimed at Wappler developers who want full control over how their project is containerised and deployed, but it is not Wappler-specific — it works with any Node.js Docker project.

The user chooses whether to use it. Wappler's own deployment continues to work exactly as before, completely unaffected.

It runs as a **Docker container** on the developer's machine, guides the user through a wizard to configure their project for production, generates all required Docker and infrastructure files, and deploys to the target host — with complete visibility and control at every step. It is designed to run **alongside the Wappler IDE** on the same workstation.

### Problem it solves
Wappler's default deployment:
- Opaque process with no ability to customise the Docker configuration
- No support for add-on services (reverse proxy, caching, monitoring, etc.)
- No way to manage environment-specific configs (staging vs production)
- No persistent pipeline or reproducible deployment artifact

This tool replaces that with a transparent, configurable, repeatable pipeline the developer owns entirely.

---

## UI Wizard Flow

### Step 1 — Point to Project
- Path to the root of the Node.js project on the local machine
- Read `package.json` to determine Node.js version and installed dependencies
- Detect existing `Dockerfile` and `docker-compose.yml` if present — displayed as read-only reference; never modified
- This tool generates its own parallel set of files (`Dockerfile.deploy`, `docker-compose.deploy.yml`) written into `wdp/{profile}/` — the original project files are untouched
- **Select or create a profile** — each profile is a separate deployment configuration (e.g. `staging`, `production`). **Each profile must point at its own Wappler project folder** on disk (`projectPath` in Step 1). WDP blocks saving the wizard or initialising Git if two profiles share the same folder. Changing the profile name does not change the folder — update Step 1 and validate the path for every new profile

### Step 2 — Build environment
- Informational step: explains that WDP builds your app in Docker (`Dockerfile.deploy` from `package.json`)
- Does **not** change the host server OS — that is Step 4

### Step 3 — Database Configuration
- Type: PostgreSQL, MySQL/MariaDB, SQLite (dev only)
- Location: Same Docker Compose stack (managed), External managed DB (e.g. DO Managed Database), or existing self-hosted instance
- User enters connection values (host, port, name, user, password); these are written into the generated `docker-compose.deploy.yml`

### Step 4 — Hosting Target
- **DigitalOcean Droplet** — link an **existing** Droplet (import picker) or **provision** a new one (region, size, SSH key, host OS image)
- **Existing Droplet:** host OS and CPU architecture are **detected** from DigitalOcean (read-only). WDP does not upgrade or reinstall the OS. Optional destructive rebuild if you need a different OS image.
- **Provision new Droplet:** choose host OS image and CPU architecture here
- **Self-hosted VPS** — SSH host, user, key path; choose CPU architecture
- **Local Docker** — deploy to the local Docker daemon; choose CPU architecture
- **Railway** — coming soon (UI placeholder)
- Remote Docker readiness check below SSH fields (Podman / old Compose detection). Install Docker from the profile **Server** tab after the profile is saved.

> **Note:** The SSH connection details entered here (`sshHost`, `sshUser`, `sshKeyPath`) are automatically re-used by the SSH Terminal feature — no re-entry needed.

### Step 5 — Add-on Services
The user selects optional services to include in the generated `docker-compose.yml`. Each add-on that requires configuration **expands inline as an accordion panel immediately after it is toggled on** — the user must fill in required fields before they can proceed. Required fields are clearly marked; optional fields are collapsed under an "Advanced" disclosure.

Secrets collected here (passwords, keys) are stored in the profile's env block in `wdp-config.json` (the generated compose file is already gitignored). Ports default to standard values but are always overridable to avoid host conflicts.

| Service | Purpose |
|---|---|
| **Traefik** | Reverse proxy + automatic Let's Encrypt SSL (recommended over standalone Certbot) |
| **Redis** | Session store / caching |
| **MinIO** | S3-compatible self-hosted object storage for uploads |
| **Portainer CE** | Docker container management UI |
| **Uptime Kuma** | Lightweight self-hosted uptime / status monitoring |
| **Plausible CE (self-hosted)** | [Community Edition](https://github.com/plausible/analytics) (`ghcr.io/plausible/community-edition`) — AGPL, on your VPS; **not** paid [Plausible Cloud](https://plausible.io/) |
| **Mailpit** | Local email testing (dev/staging only) |
| **n8n** | Open-source workflow automation |
| **Restic + REST backend** | Scheduled encrypted backups — `uploads/` volume and DB dumps to local path, MinIO, or any S3-compatible target |
| **Apprise / webhook** | Deploy notifications to Discord, Slack, Telegram, or any generic webhook on success or failure |

**Per-add-on configuration prompts** (shown inline when the add-on is enabled):

**Traefik**
- `domain` *(required for non-local)* — the public domain name Traefik will route to the app (usually the apex, e.g. `example.com`); must already point to the server via DNS before deploying
- `includeWww` *(default: on)* — also route and include in the Let's Encrypt certificate **`www.{domain}`** (or the apex if you entered `www` as the primary domain). Requires DNS for **both** hostnames. Sets `TRAEFIK_ALT_HOST` in `.env.deploy`
- **DNS registrar guide** — when Traefik is enabled on a remote target, an inline info panel explains that WDP cannot configure Fasthosts/GoDaddy/etc.: either add `@` / `www` **A** records to the Droplet IP at the registrar, or switch **nameservers** to DigitalOcean and manage DNS there (Server → DNS after deploy); propagation up to 48 hours
- `acmeEmail` *(required for non-local)* — email address for Let's Encrypt certificate registration and expiry notices
- `traefikMode` — `bundled` (deploy Traefik with this stack, default) or `external` (use existing server Traefik — shared staging)
- `network` — Docker network name (default: `traefik-public`; required for `external`; use `wappler-compose_proxy` for Wappler's built-in Traefik)
- `certResolver` — ACME resolver name to reference in labels (default: `leresolver`)
- `dashboard` — enable Traefik dashboard? (default: off; warns user it should not be exposed publicly without auth)
- `httpChallenge` vs `dnsChallenge` — toggle; DNS challenge requires provider credentials (shown as sub-fields if selected)

**Redis**
- `password` *(required)* — Redis `requirepass` value; tool refuses to generate a passwordless Redis config
- `db` — database index (default: `0`)
- `port` — host port (default: `6379`)
- `maxMemory` — optional `maxmemory` cap (e.g. `256mb`)
- `evictionPolicy` — optional `maxmemory-policy` (default: `allkeys-lru`)

**MinIO**
- `rootUser` *(required)* — access key / admin username
- `rootPassword` *(required)* — secret key / admin password (min 8 chars enforced)
- `defaultBucket` — bucket to create on first start (default: `uploads`)
- `apiPort` — S3 API port (default: `9000`)
- `consolePort` — web UI port (default: `9001`)

**Portainer CE**
- `port` — web UI port (default: `9000`)
- `agentPort` — Portainer agent port (default: `9001`)

**Uptime Kuma**
- `port` — web UI port (default: `3001`)

**Plausible CE (self-hosted)**
- `domain` *(required)* — the hostname Plausible will be served from (used internally for base URL)
- `adminEmail` *(required)*
- `adminPassword` *(required)*
- `secretKeyBase` — auto-generated 64-char hex if left blank
- `port` — host port (default: `8000`)

**Mailpit**
- `smtpPort` — SMTP port (default: `1025`)
- `uiPort` — web UI port (default: `8025`)

**n8n**
- `adminEmail` *(required)*
- `adminPassword` *(required)*
- `encryptionKey` — auto-generated 32-char hex if left blank; stored in config for persistence across restarts
- `port` — host port (default: `5678`)
- `webhookUrl` — external URL if n8n is exposed via Traefik (optional; needed for webhook triggers)

**Restic + REST backend**
- `repoPath` *(required)* — destination: local path, `s3:https://…`, MinIO endpoint, or Backblaze B2 URL
- `repoPassword` *(required)* — Restic repository encryption password
- `schedule` — cron expression for automatic backups (default: `0 2 * * *` — 2 AM daily)
- `backupVolumes` — checkboxes: uploads volume, DB dump (enabled by default if DB is configured), custom paths
- `retentionPolicy` — keep last N daily / weekly / monthly snapshots (defaults: 7 / 4 / 3)

**Apprise / webhook**
- `notifyUrl` *(required)* — Apprise-format URL: `discord://…`, `slack://…`, `tgram://…`, or a plain `https://` webhook URL
- `onSuccess` — notify on successful deploy (default: on)
- `onFailure` — notify on failed deploy (default: on)
- `onRollback` — notify on rollback (default: on)

### Step 6 — Scaling & Resource Limits
A single toggle drives a chain of dependent decisions automatically:

- **Horizontal scaling** (run multiple app replicas?) — if yes:
  - `SESSION_SECRET` is enforced as identical across all replicas (auto-validated)
  - Redis add-on becomes required, not optional — session storage must be shared across replicas
  - `uploads/` volume is flagged — MinIO is strongly recommended over a local bind mount to avoid split-brain file access
- **Memory limit per container** — sets `mem_limit` in the generated compose file; prevents a runaway container from OOM-killing the whole host (critical on small droplets)
- **CPU limit** — sets `cpus` limit; optional but useful on multi-tenant hosts
- **Docker HEALTHCHECK** — configures an HTTP health check in `Dockerfile.deploy` against `http://localhost:3000/` (root path, not `/health`) so Docker and Traefik v3 on Docker 29+ treat the container as healthy when the app serves its home page

### Step 7 — Security Scan
Before any files are finalised or deployment begins, the tool runs security scans against the project. The user can select which scanners to enable (all recommended by default):

- **npm audit** — baseline CVE check, always runs (zero install required)
- **OSV-Scanner** — supply chain CVE check against `package-lock.json`
- **Socket CLI** — detects malicious npm packages and supply chain attack patterns
- **Gitleaks** — scans the project directory for accidentally committed secrets or credentials
- **Trivy** — scans the built Docker image for CVEs, OS package vulnerabilities, and misconfigurations
- **Grype + Syft** — generates an SBOM then scans it; provides a second-opinion image scan

Results are presented as a severity-grouped report (Critical / High / Medium / Low). Critical findings are highlighted prominently. The user can configure whether Critical findings block deployment or are acknowledged and bypassed. **Run security scans on deploy** (Step 7) can be turned off for faster deploys; npm audit HIGH/MEDIUM warnings do not block deploy unless block-on-critical is enabled. Scans run before build/sync in the deploy log. The full scan report is included in the `.zip` export alongside the generated Docker files.

### Step 8 — Review & Generate
- Preview the generated `Dockerfile.deploy`, `docker-compose.deploy.yml`, and Traefik config with full syntax highlighting
- **Diff view** — if files already exist for this profile from a previous generation, show a before/after diff so the user can see exactly what changed before committing to a new deploy
- Security scan report summary shown inline
- Option to copy to clipboard, download as `.zip`, or commit `wdp/` files directly to the project repo via the integrated Git panel

### Step 9 — Deploy
**Pre-deploy readiness checks** run automatically before deployment begins:
- SSH key can authenticate to the target host
- Required ports are open and reachable (80, 443, app port)
- Domain DNS is resolving to the target server IP
- Sufficient disk space on the host for the image and volumes
- Docker and Docker Compose are installed on the host and meet minimum version requirements
- **Traefik (Docker 29)** — generated compose must pin Traefik v3.6.1+ (WDP uses `traefik:v3.6.7`) when Traefik is enabled

If any check fails it is shown clearly with a specific fix suggestion before the deploy button becomes active.

- One-click deploy: pushes files to target via SSH or API, runs `docker compose -f docker-compose.deploy.yml up -d`
- Live log streaming from the remote deploy process back to the UI
- Post-deploy health check: confirms app is reachable and DB connection is live
- **Post-deploy Docker cleanup** — on the profile **Deploy** tab only: after a successful deploy, run the health check; if it passes, an optional **Docker cleanup** section appears. Runs `docker system prune -f` (dangling) or `docker system prune -af` (all unused) on the target host. Opt-in only; does not remove running app containers
- Deployment result (success/failure, timestamp, profile, git commit hash if available) written to deployment history
- Notification dispatched on completion if a webhook/notification add-on is configured

---

## Tool Architecture

### Delivery Method
Unzip the package, then one command (no Git required):

Run **`docker compose up -d --build`** (see [how-it-works.md](how-it-works.md)).

Supported on **Linux**, **macOS**, and **Windows** with Docker Desktop ([installation.md](installation.md)). No install scripts. Your **home directory** is mounted so users can browse to projects and `~/.ssh`. On Windows, copy `.env.example` to `.env` if `HOME` is not set.

Data is stored in Docker volume **`wdp-data`**. WDP uses the host Docker socket to run local and remote deployments.

> **Security:** WDP can run Docker and SSH on your behalf. Admin password required from first run; all routes are session-protected. Do not expose port 8900 to the public internet without a firewall or reverse proxy with access controls.

### Tech Stack
| Layer | Choice | Reason |
|---|---|---|
| Backend | Node.js + Express | Lightweight, well understood; shipped in the `wdp` Docker image |
| Frontend | SvelteKit (SPA mode) | Lightweight, fast, no heavy framework overhead |
| Styling | Tailwind CSS | Utility-first, easy dark theme, mobile-first |
| Docker management | Dockerode | Node.js Docker SDK, full API coverage |
| SSH / remote deploy + terminal | ssh2 + xterm.js | Low-level SSH2 library used directly for both remote command execution and PTY terminal sessions; xterm.js renders the terminal in the browser |
| Config storage | JSON files (per project) | Human-readable, easy to back up and version |
| i18n | i18next + svelte-i18n | Industry standard, JSON translation files, runtime switching |
| AI assistant | OpenRouter API | Provider-agnostic LLM gateway; user supplies their own key |
| Port | `8900` | Clear of Wappler (8100) and Portainer (8000/9443) |

### Internationalisation (i18n)
The entire UI is fully localised. Supported languages at launch:

| Code | Language |
|---|---|
| `en` | English (default) |
| `pt` | Portuguese (European) |
| `es` | Spanish (European) |
| `de` | German |
| `nl` | Dutch |

- Language is selected on first run and stored in `wdp-config.json`
- All wizard labels, tooltips, error messages, and generated file comments are translated
- Translation files live in `locales/{code}.json` — easy to extend with additional languages
- Bulgarian (`bg`) locale file exists on disk as a stub; not shown in LanguageSelector until a full translation is contributed
- Date/number formatting follows the selected locale

### AI Assistant
The tool includes an optional AI assistant powered by [OpenRouter](https://openrouter.ai). The user connects their own OpenRouter account by entering an API key in Settings — no key is bundled with the tool.

**How it works:**
- A persistent `skills.md` file ships with the tool containing detailed knowledge of: the deployment pipeline, every wizard step, Wappler-specific conventions, all supported add-on services, and common troubleshooting scenarios
- If the user has generated a `knowledge.md` for their project (see below), this is also injected alongside `skills.md` — giving the assistant full awareness of both the tool *and* the specific application being deployed
- The user can ask natural language questions at any point in the wizard, e.g. *"What does enabling Traefik do to my setup?"* or *"Which database option is best for a DigitalOcean deployment?"*
- The assistant can also review a generated `docker-compose.deploy.yml` and explain what each section does in plain language
- Model selection is exposed in Settings — the user can choose any OpenRouter-supported model (defaults to a capable, cost-effective option)
- All API calls are made server-side (Express backend) so the user's key is never exposed to the browser

### Project Knowledge Generation
Inspired by [Repomix](https://github.com/yamadashy/repomix) (which packs a repo into a single LLM-ready file), this feature analyses an existing Wappler project using the user's selected OpenRouter model and produces two complementary outputs:

**`knowledge.md`** — A human-readable document describing the application, auto-generated by the LLM after reading the project files. Covers:
- Application purpose and overview (inferred from page content, routes, and API structure)
- All views and page layouts
- All API endpoints and backend action files
- Reusable modules and shared logic
- Database connections and inferred schema
- Security configuration
- Static assets and public directory structure
- Any additional directories the user specifies

**`knowledge.json`** — A Repomix-style packed representation of all relevant project files in a single structured JSON, optimised for LLM context window injection. Excludes `node_modules`, build artefacts, and binary assets. Each file is annotated with its role in the project.

**How it works in the UI:**
- A **Generate Knowledge** button is available on the project dashboard (requires OpenRouter key to be configured)
- The user can optionally specify additional directories to include (e.g. a `docs/` folder, a design brief, a `specs/` directory)
- The backend walks the Wappler project tree, assembles the relevant file contents, and sends them to the selected OpenRouter model with a structured prompt
- Progress is shown in real time as the LLM streams its response
- An **Update Knowledge** button re-runs the same process and overwrites both files — useful after adding new pages, API actions, or restructuring the app
- Both files are written to `wdp/` alongside the deployment files so they are versioned and portable

**The `knowledge.md` and `knowledge.json` serve three purposes:**
1. Grounding the AI assistant with project-specific context (the assistant knows what *this* app does, not just generic Wappler knowledge)
2. Giving the user a living, auto-maintained document describing their own application
3. Providing a ready-to-use packed context file if the user wants to use the project knowledge outside this tool (e.g. pasting into Claude, ChatGPT, etc.)

### Security Scanning
The pipeline includes an optional but recommended pre-deploy security scan covering three attack surfaces: the container image, the Node.js dependency tree, and the project files. All tools listed below are open source and run locally — no data leaves the machine.

| Tool | What it scans | Why |
|---|---|---|
| **[Trivy](https://github.com/aquasecurity/trivy)** | Container image CVEs, OS packages, npm deps, secrets, misconfigurations | Most comprehensive single open source scanner; one binary, zero config |
| **[Grype](https://github.com/anchore/grype)** | Container image + filesystem CVEs (NIST NVD, GitHub Advisory, OSV) | Excellent second opinion alongside Trivy; fast and CI-friendly |
| **[Syft](https://github.com/anchore/syft)** | Generates an SBOM (Software Bill of Materials) in CycloneDX / SPDX | Pairs with Grype; gives the user a full inventory of what is in the image |
| **[OSV-Scanner](https://github.com/google/osv-scanner)** | npm `package-lock.json` against Google's OSV database | Purpose-built for supply chain CVEs; catches things NVD misses |
| **[Socket CLI](https://github.com/SocketDev/socket-cli-js)** | npm supply chain attacks (typosquatting, malicious installs, protestware) | Specifically designed to catch the class of attack npm audit does not — malicious intent vs just known CVEs |
| **[Gitleaks](https://github.com/gitleaks/gitleaks)** | Secrets / credentials accidentally committed to the project repo | Prevents DB passwords and API keys from being baked into the image or pushed to a remote repo |
| **`npm audit`** | Known CVEs in `package.json` dependencies | Built-in, zero install required; useful baseline even when other tools are enabled |

**Docker Scout** (Docker's official scanner) is also supported if the user already has it installed, but it is not open source — it is noted as an optional extra rather than a default.

**Scan results are:**
- Displayed in a summary report inside the UI before deploy is permitted
- Categorised by severity: Critical, High, Medium, Low, Info
- Non-blocking by default — the user can acknowledge and proceed — but Critical findings can optionally be set to block deployment
- Exportable as JSON alongside the other generated files

---

## SSH Terminal

For any profile that has SSH connection details configured (i.e. a remote hosting target), the project dashboard exposes a **Terminal** tab that opens a full PTY shell session directly on the remote server — inside the browser, no separate SSH client needed.

**How it works:**
- Frontend: `xterm.js` renders a full terminal emulator with colour support, scrollback buffer, and copy/paste
- Backend: `ssh2` opens a PTY channel to the remote host using the key path from the profile (`sshKeyPath`), authenticates as `sshUser` on `sshHost`
- Transport: WebSocket connection between xterm.js and the Express backend bridges stdin/stdout in real time
- Resize events from xterm.js are forwarded to the PTY so the remote shell reflows correctly

**Connection source:** Credentials are pulled directly from the active profile — the user never re-enters them. If a profile has no SSH details (e.g. Local Docker, Railway), the Terminal tab is hidden.

**Session behaviour:**
- One session per profile at a time — opening a second tab re-uses the same channel if still alive, or reconnects
- Session closes cleanly when the browser tab is closed or the user clicks Disconnect
- No session state is persisted — it is a live connection, not a recording
- Inactivity timeout configurable in Settings (default: 30 minutes)

**Security:**
- Only key-based auth — no password auth is ever used or supported (consistent with deployment SSH behaviour)
- All WebSocket frames are authenticated via the same session token as the rest of the UI
- Commands typed in the terminal are not logged (this is a live PTY, not a command runner)
- The SSH private key is read server-side from the path on disk; it is never transmitted to the browser

**UI:**
- Accessible from the profile dashboard via a **Terminal** tab alongside Deploy, History, and Settings
- Connection status badge: Connecting / Connected / Disconnected
- One-click Reconnect button when the session drops
- Font size and scrollback line count configurable per session

---

## Project Configuration File

Each project has a single `wdp-config.json` that contains all named profiles. Each profile is fully independent — its own hosting target, database config, add-ons, domain, and generated file set. Profiles can be created from scratch or duplicated from an existing one.

Generated files are written into a `wdp/` subdirectory inside the project root, namespaced by profile name, keeping everything together and easy to commit:

```
project-root/
├── wdp/
│   ├── wdp-config.json
│   ├── knowledge.md           # LLM-generated project description
│   ├── knowledge.json         # Repomix-style packed context file
│   ├── staging/
│   │   ├── Dockerfile.deploy
│   │   ├── docker-compose.deploy.yml   # gitignored — contains env vars
│   │   ├── traefik/
│   │   └── scan-report.json
│   └── production/
│       ├── Dockerfile.deploy
│       ├── docker-compose.deploy.yml   # gitignored — contains env vars
│       ├── traefik/
│       └── scan-report.json
```

Top-level keys (not per-profile):

```json
{
  "auth": {
    "username": "admin",
    "passwordHash": "…",
    "email": "ops@example.com",
    "mobile": "7712345678",
    "dialingCode": "+44",
    "locale": "en"
  },
  "ai": { "apiKey": "…", "model": "minimax/minimax-m2.7" },
  "digitalOcean": { "apiKey": "dop_v1_…" },
  "clickSend": {
    "username": "…",
    "apiKey": "…",
    "onSuccess": true,
    "onFailure": true,
    "onRollback": true
  }
}
```

Profile entries (excerpt):

```json
{
  "schemaVersion": "1.0",
  "projectName": "my-app",
  "projectRoot": "/path/to/project",
  "profiles": {
    "staging": {
      "targetOS": "ubuntu-24.04",
      "nodeVersion": "20",
      "database": {
        "type": "postgres",
        "managed": false,
        "host": "db",
        "port": 5432,
        "name": "myapp_staging"
      },
      "hostingTarget": "local",
      "addons": {
        "traefik": { "domain": "staging.myapp.example.com", "acmeEmail": "dev@example.com", "network": "traefik-public", "certResolver": "leresolver", "dashboard": false },
        "mailpit": { "smtpPort": 1025, "uiPort": 8025 }
      },
      "domain": "staging.myapp.example.com",
      "appPort": 3000
    },
    "production": {
      "targetOS": "ubuntu-24.04",
      "nodeVersion": "20",
      "database": {
        "type": "postgres",
        "managed": true,
        "host": "db-production.example.com",
        "port": 5432,
        "name": "myapp_production"
      },
      "hostingTarget": "digitalocean",
      "doDropletId": 123456789,
      "doApiKey": "",
      "sshHost": "123.456.789.0",
      "sshUser": "root",
      "sshKeyPath": "~/.ssh/id_ed25519",
      "remotePath": "/opt/my-app",
      "addons": {
        "traefik": { "domain": "myapp.example.com", "acmeEmail": "ops@example.com", "network": "traefik-public", "certResolver": "leresolver", "dashboard": false },
        "redis": { "password": "REDIS_PASSWORD", "db": 0, "port": 6379 },
        "uptime-kuma": { "port": 3001 }
      },
      "domain": "myapp.example.com",
      "appPort": 3000
    }
  }
}
```

Profiles can be created, duplicated, renamed, and deleted from the project dashboard. Duplicating a profile (e.g. copying `production` to `production-eu`) is the fastest way to set up a new environment.

---

## Design
- Dark theme only — no light mode toggle
- Mobile-first responsive layout
- Step progress indicator persisted across wizard steps
- Inline documentation callouts at each step explaining options and trade-offs
- Dangerous actions (deploy, overwrite config) require an explicit confirmation step
- Language selector in the header — switches locale without a page reload
- AI assistant panel accessible from any page via a persistent button; renders markdown responses
- **Profile switcher** visible on every page of the wizard — shows the active profile name (e.g. `production`) with a dropdown to switch to another profile or create a new one without leaving the current step
- **Inline help tooltips** — every form field, toggle, and option has a clickable `?` icon that opens a popover explaining:
  - What the field is and why it is needed
  - What a sensible default or typical value looks like
  - Any project-specific gotchas relevant to that field (e.g. the session secret tooltip explains it must match across all containers if running multiple replicas)
  - Tooltips are fully translated as part of the i18n system

---

## Development Phases

### Phase 1 — Foundation
- [ ] Scaffold Node.js + Express backend
- [ ] Scaffold SvelteKit SPA frontend
- [ ] Dockerise the tool itself (port 8900)
- [ ] **Authentication:**
  - [ ] First-run setup screen — prompts for an admin username and password before any other screen is accessible; credentials stored as a bcrypt hash in `wdp-config.json`
  - [ ] Login screen with session cookie (httpOnly, sameSite=strict)
  - [ ] All Express API routes protected by session middleware — unauthenticated requests return 401
  - [ ] WebSocket upgrade endpoint validates session token before allowing connection
  - [ ] Logout endpoint that destroys the session
  - [ ] Warning banner in the UI if the tool detects it is bound to `0.0.0.0` (i.e. potentially publicly reachable)
- [ ] Implement project config JSON read/write
- [ ] Project path validation (confirm `package.json` exists)

### Phase 2 — Wizard UI
- [ ] Build step-by-step wizard component with state persistence
- [ ] Implement all 9 wizard steps with validation
- [ ] Dark theme Tailwind design system
- [ ] Tooltip/popover component — reusable `?` icon that accepts a title, body text, default value hint, and optional gotcha note
- [ ] Author tooltip copy for every field across all 9 wizard steps
- [x] Tooltip content included in i18n translation files — all ~70 tooltip instances across steps 1–7 fully translated into all five supported languages

### Phase 3 — File Generation
- [ ] `Dockerfile.deploy` generator (Node.js base image, correct build steps, Docker HEALTHCHECK)
- [ ] `docker-compose.deploy.yml` generator (app + selected add-ons, env vars inline, optional mem/cpu limits)
- [ ] Traefik config generator (with Let's Encrypt)
- [ ] Preview pane with full syntax highlighting
- [ ] Diff view — compare newly generated files against previous generation for the same profile
- [ ] Auto-patch `.gitignore` to exclude `wdp/*/docker-compose.deploy.yml` on first run

### Phase 4 — Deployment
- [ ] SSH connection module (key-based auth only — no password auth)
- [ ] Pre-deploy readiness checks (SSH auth, port reachability, DNS resolution, disk space, Docker version)
- [ ] DigitalOcean API integration (optional — provision droplet via API)
- [ ] Railway API integration
- [ ] Remote `docker compose -f docker-compose.deploy.yml up -d` with live log streaming
- [ ] Post-deploy health check (HTTP reachability + DB connection)
- [ ] Post-deploy Docker cleanup prompt — gated behind passing health check; offer `docker system prune -f` (dangling only) or `docker system prune -af` (all unused images); opt-in, confirmation required, output streamed to UI
- [ ] Deployment history log — timestamped record per profile (outcome, git commit hash, generated file snapshot)
- [ ] Rollback — re-deploy any previous generation from deployment history
- [ ] Webhook/notification dispatch on deploy success or failure
- [ ] **SSH Terminal:**
  - [ ] `ssh2` PTY channel on the backend, opened on WebSocket upgrade request
  - [ ] xterm.js terminal component on the frontend
  - [ ] WebSocket bridge: pipe xterm stdin → SSH channel stdin, SSH channel stdout → xterm
  - [ ] Forward terminal resize events (cols/rows) to PTY
  - [ ] Session auth: WebSocket connection gated behind the same session token as the rest of the UI
  - [ ] Terminal tab visible only on profiles with SSH connection details; hidden for local/Railway targets
  - [ ] Inactivity timeout with configurable default (30 min)
  - [ ] Reconnect button on disconnect

### Phase 5 — Polish & Git Integration
- [ ] Profile manager — create, duplicate, rename, delete profiles within a project
- [ ] Profile switcher component in wizard header (switch without losing current step)
- [ ] `wdp/` output directory structure namespaced per profile
- [ ] Config file manager (save / load / duplicate whole project config)
- [ ] Export a single profile's generated files as `.zip` (including scan report)
- [ ] Export all profiles as a single `.zip`
- [ ] **Git integration:**
  - [ ] Detect if the project is a git repo; display current branch and status in the UI
  - [ ] Commit generated `wdp/` files (excluding `docker-compose.deploy.yml`) with an auto-generated message, e.g. `chore(wdp): regenerate production deployment files`
  - [ ] Create and push a deployment tag on successful deploy, e.g. `deploy/production/2026-05-23T14:32:00`
  - [ ] Link deployment history entries to their git commit hash for full traceability
  - [ ] Show git diff of `wdp/` changes since the last deployment tag
  - [ ] Auto-add `wdp/*/docker-compose.deploy.yml` to `.gitignore` on first run
- [ ] CI/CD webhook endpoint — authenticated `POST /deploy/:project/:profile` to trigger deployments from GitHub Actions, GitLab CI, or any external system
- [ ] Docs / help tooltips throughout UI

### Phase 6 — Security Scanning
- [x] Bundle / detect Trivy and run image scan post-build
- [x] Integrate OSV-Scanner against `package-lock.json`
- [x] Integrate Socket CLI for supply chain attack detection
- [x] Integrate Gitleaks for secrets detection pre-build
- [x] Integrate Grype + Syft for SBOM generation and second-opinion image scan
- [x] Severity-grouped scan results UI with Critical/High/Medium/Low/Info breakdown
- [x] Configurable block-on-critical setting
- [x] Scan report export as JSON alongside Docker files
- [x] Optional Docker Scout integration (for users who already have it)
- [x] Per-finding Dismiss / Restore actions (persisted to /data/security-dismissals.json)
- [x] npm audit fix shortcut button (streams fix log, prompts re-deploy)
- [x] Scanner binaries (Trivy, Gitleaks, OSV-Scanner) pre-installed in Docker image

### Phase 7 — i18n, AI Assistant & Project Knowledge
- [x] Integrate i18next + svelte-i18n
- [x] Author base English translation file (`locales/en.json`) covering all UI strings
- [x] Translate to Portuguese (European), Spanish (European), German, Dutch — full human translations including all wizard strings and all ~70 tooltip instances across steps 1–7
- [x] Bulgarian locale (bg.json) created as stub; removed from LanguageSelector pending full translation contribution — file retained on disk
- [x] Language selector component in header with locale persistence
- [ ] Author `skills.md` — comprehensive knowledge base covering the pipeline, all wizard steps, all supported add-on services, security tools, and troubleshooting
- [x] OpenRouter API key settings screen (key stored securely, never logged)
- [x] Server-side AI proxy endpoint in Express (keeps API key off the client)
- [x] AI assistant panel component with markdown rendering and context-aware prompting
- [ ] Dual context injection: `skills.md` (tool knowledge) + `knowledge.md` (project knowledge) in system prompt
- [x] Model selector in Settings (with sensible default)
- [x] Project file walker — collects relevant source files (views, API files, config, modules) and excludes noise (node_modules, build artefacts, binaries)
- [x] Optional additional directory selector for user-supplied docs/specs
- [x] **Generate Knowledge** button — sends packed project files to OpenRouter LLM, streams response, writes `wdp/knowledge.md`
- [x] **Update Knowledge** button — re-runs generation and overwrites existing knowledge files
- [x] `knowledge.json` generator — Repomix-style packed context file with per-file role annotations
- [x] Include `knowledge.md` and `knowledge.json` in `.zip` export

### Phase 7 — Docker 29.x / Traefik Compatibility ✅
> **Shipped (May 2026):** WDP targets Docker Engine 29+ (e.g. current DigitalOcean Droplets).
> See `about.md` for the full troubleshooting matrix. Summary:
>
> - **Traefik image** — `traefik:v3.6.7` in generated compose; pre-deploy check; auto-upgrade of
>   stale `traefik:v3.0` on deploy; post-deploy log check for `client version 1.24 is too old`
> - **ACME HTTP-01** — no entrypoint-wide port-80→HTTPS redirect (breaks Let's Encrypt); per-router redirect instead
> - **Unhealthy container filter** — HEALTHCHECK uses `/` not `/health`; `allowEmptyServices` on Traefik provider
> - **External network** — `docker network create traefik-public` before remote `up`
> - **Port conflicts** — release 80/443/3000 before compose up on redeploy
> - **Compose interpolation** — `--env-file` on all remote `docker compose` commands
> - **SSH deploy** — rsync project to `remotePath`, then remote compose with `--project-directory`
> - **Redis** — standard internal-network `redis:7-alpine` + `REDIS_URL`; no separate Docker-29 API issue

### Phase 8 — (Reserved)
> Placeholder for future planning.

### Phase 9 — DigitalOcean Server Management ✅
Optional extension for DigitalOcean-hosted profiles. Uses the profile's DO API token (or the
global token from Settings) and existing SSH credentials for SFTP.

- [x] **Server** tab on the profile dashboard (`hostingTarget === 'digitalocean'`)
- [x] **Overview** sub-tab — live Droplet details via DO API; Refresh; **Find my Droplet**
      (match `sshHost` to account Droplets); `doDropletId` persisted after provision, find, or lookup
- [x] **DNS** sub-tab — list/create/edit/delete records; one-click **fix A record** when domain
      does not point at the Droplet IP (Let's Encrypt helper)
- [x] **Files** sub-tab — SFTP browser from `remotePath` (upload, download, view, rename,
      delete, breadcrumbs, hidden-files toggle)
- [x] Backend: `backend/src/lib/digitalocean.js`, `backend/src/lib/sftp.js`,
      `backend/src/routes/server.js` mounted at `/api/server/:profile/...`
- [x] Per-profile DO token on Server tab; **global DO API token** in Settings (used when profile
      has no token); wizard Step 4 preserves existing token on re-generate
- [x] Referral sign-up link in Settings → DigitalOcean
- [x] Fully i18n'd (en, pt, es, de, nl)
- [ ] **Security / hardening** sub-tab (planned) — SSH audit, UFW, fail2ban, unattended-upgrades;
      not Step 5 add-ons. Until built, see
      [`host-security.md`](host-security.md) — manual Droplet checklist until in-app Server → Security ships
      for a manual Droplet checklist.

### Phase 10 — SMS Notifications via ClickSend ✅
Supplements Apprise/webhook notifications with direct SMS to the logged-in user's mobile
number from **My Profile** (`dialingCode` + `mobile` → E.164).

**User Profile (prerequisite):**
- [x] `/profile` — email, mobile, dialling code, change password; `config.auth` in `wdp-config.json`
- [x] `auth.locale` stored for SMS language (updated from language selector and profile save)

**ClickSend integration:**
- [x] Settings → **ClickSend SMS** — username + API key (password fields, write-only after save),
      event toggles (success / failure / rollback) with **auto-save on change** via
      `POST /api/config/clicksend/notifications`, **Send test SMS**
- [x] Test SMS uses My Profile number; message text in the user's **current UI locale** (en/pt/es/de/nl)
- [x] Deploy hooks call `dispatchSms()` — same triggers as webhooks; errors logged only, never block deploy
- [x] Localised message templates in `backend/src/lib/clicksendMessages.js`
- [x] API: `GET/POST /api/config/clicksend`, `DELETE /api/config/clicksend/credentials`,
      `POST /api/config/clicksend/test`; credentials in `config.clickSend` (redacted from `GET /api/config`)
- [x] Referral sign-up link in Settings → ClickSend
- [x] Fully i18n'd (en, pt, es, de, nl)

### Dashboard at a glance ✅
- [x] Main dashboard profile cards show hosting badge, project/domain subtitle, last deploy
      outcome (success / failed / in progress / never), timestamp, and **Open app** link when URL known
- [x] `GET /api/deploy/summary` — merges deploy history with in-flight deploys from `deployManager`
- [x] i18n for all card strings (en, pt, es, de, nl)
- [x] **Deploy activity heatmap** — GitHub-style 52-week grid on main dashboard (all profiles) and each profile **History** tab; `GET /api/deploy/activity` and `GET /api/deploy/:profile/activity`; daily rollup in `deploy-history.json` (`backend/src/lib/deployActivity.js`, `DeployActivityHeatmap.svelte`)

### Deploy reliability & onboarding (May 2026) ✅
- [x] Wizard Step 5 — DNS / registrar guidance panel when Traefik enabled (remote targets)
- [x] Wizard Step 7 — `scanOnDeploy` toggle; deploy UI clarifies scan-before-build timing
- [x] Deploy panel — live log above scan results; hint when domain set but Traefik disabled (`http://domain:3000`)
- [x] Profile wizard sync — SSH host / domain merged from saved profile on dashboard edit
- [x] `backend/src/lib/traefikCompat.js` — single source of truth for Traefik image version