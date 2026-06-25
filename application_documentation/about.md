# 🚀 Wappler Deployment Pipeline

**A free deployment tool built by the community, for the community.**

**Install:** [README](../readme.md) · **Beta testers:** [beta.md](beta.md)

---

## What is it?

The Wappler Deployment Pipeline (WDP) is a **Docker application** that gives you **complete control over how your Wappler project is containerised and deployed to production**.

Wappler is fantastic for building Node.js apps visually — and its built-in deployment works great for most users. WDP is for developers who want to go further: full control over containerisation, custom infrastructure, add-on services, and a deployment pipeline that *you* own. It sits *alongside* Wappler and never touches your project files.

> Wappler's own deployment continues to work exactly as before. WDP is entirely optional — use it only if you want more control.

---

## Who is it for?

- Wappler developers deploying **Node.js** apps (usually **Server Connect**) to **DigitalOcean**, a **VPS**, or **local Docker**
- Anyone who wants **Traefik + automatic SSL** without manual config
- Teams who need **multiple deployment profiles** (staging, production, demo) for the same project
- Developers who want **security scanning** built into their pipeline
- Anyone tired of manually writing `docker-compose.yml` files from scratch

---

## Supported project types

WDP is **not** a generic “deploy any stack” tool. The wizard and generators are built for **Wappler + Node.js**:

- Step 1 expects a **`package.json`** in your project folder (Wappler’s Node / Server Connect layout).
- Generated **`Dockerfile.deploy`** uses a **Node** base image, runs **`node index.js`**, and exposes port **3000** (Traefik and health checks assume that port).
- Step 7 security scans focus on **npm** and Node-oriented tooling.

**Supported today:** Wappler projects that ship as a **Node** app with `package.json`.

**Not supported today (beta):**

- **LAMP** / classic **PHP + Apache/nginx** stacks as a one-click generated pipeline
- **PHP-only** Wappler targets without a Node `package.json`
- Arbitrary non-Node runtimes (unless you hand-edit generated Docker files yourself — not guided by the wizard)

If your project uses Wappler’s **standard Node deployment**, WDP is for you. For other stacks, use Wappler’s own deployment or a custom Docker setup until WDP grows broader runtime support.

---

## How does it work?

WDP runs as a **Docker container** named `wdp`. You open it in your browser, run through a **9-step wizard**, and it generates all the deployment files you need — then deploys them to your server (or local Docker) with one click.

```text
docker compose up -d --build
```

Then open **http://localhost:8900**. Your home directory is mounted so you can browse to projects and SSH keys.

See [how-it-works.md](how-it-works.md) for a short picture of WDP vs your app containers, and [installation.md](installation.md) for Mac, Windows, and Linux.

---

## The Wizard — Step by Step

| Step | What you configure |
|------|--------------------|
| **1 — Project** | Point WDP at your Wappler project folder. It reads your `package.json` automatically. Create or select a named profile (e.g. `staging`, `production`). |
| **2 — Build environment** | How your app is built for Docker (`Dockerfile.deploy` from `package.json`). Does not change the server OS. |
| **3 — Database** | PostgreSQL, MySQL, or SQLite. Managed in the same stack, external managed DB, or existing self-hosted instance. |
| **4 — Hosting Target** | DigitalOcean (import existing or provision new), VPS, or Local Docker. Host OS and CPU architecture are set or detected here — not Step 2. SSH key browse, connection test, and remote Docker readiness check. |
| **5 — Add-on Services** | Toggle on any services you need (see full list below). Each one expands inline for configuration. |
| **6 — Scaling & Resources** | Horizontal scaling, memory/CPU limits, Docker HEALTHCHECK. |
| **7 — Security Scan** | Run security scanners against your project before deploying. |
| **8 — Review & Generate** | Preview all generated files with syntax highlighting before anything is written. |
| **9 — Deploy** | Pre-flight checks, one-click deploy, live log streaming, post-deploy health check. |

---

## Add-on Services

WDP can automatically configure and deploy any of these alongside your app:

| Service | What it does |
|---------|-------------|
| **Traefik** | Reverse proxy with automatic Let's Encrypt SSL — no Certbot needed |
| **Redis** | Session store and caching |
| **MinIO** | Self-hosted S3-compatible object storage for uploads |
| **Portainer CE** | Docker container management UI |
| **Uptime Kuma** | Lightweight uptime and status monitoring |
| **Plausible CE (self-hosted)** | Community Edition on your server (AGPL) — not paid Plausible Cloud |
| **Mailpit** | Local email testing for staging environments |
| **n8n** | Open-source workflow automation |
| **Restic + REST backend** | Scheduled encrypted backups to local storage, MinIO, or any S3 target |
| **Apprise / Webhook** | Deploy notifications to Discord, Slack, Telegram, or any webhook |

---

## What gets generated?

WDP writes three files into a `wdp/{profile}/` folder inside your project:

- **`Dockerfile.deploy`** — a production-optimised multi-stage Docker build for your app
- **`docker-compose.deploy.yml`** — your full stack: app, database, Traefik, and any add-ons you enabled
- **`.env.deploy`** — all environment variables, clearly labelled with `CHANGE_ME` placeholders for secrets

Your original `Dockerfile` and `docker-compose.yml` are **never touched**. The `wdp/` files are automatically added to `.gitignore` to prevent secrets leaking to version control.

---

## Security Scanning

Before deploying, WDP runs a suite of security scanners against your project:

- **npm audit** — CVE check against your dependencies (always on)
- **OSV-Scanner** — supply chain CVE check via Google's OSV database
- **Socket CLI** — detects malicious packages and supply chain attack patterns
- **Gitleaks** — scans for accidentally committed secrets or credentials
- **Trivy** — filesystem CVE scan
- **Grype + Syft** — SBOM generation and second-opinion vulnerability scan

Critical findings are highlighted prominently. You can configure whether criticals block the deploy, or acknowledge and bypass them with a reason. All findings are persisted — dismissed findings stay dismissed until you restore them.

---

## Deployment

When you hit Deploy:

1. **Pre-flight checks** run automatically — SSH auth, DNS resolution, port availability, disk space, Docker version, Traefik image compatibility on Docker 29+
2. Files are transferred to the remote server over SSH
3. `docker compose up -d --build` runs on the remote host
4. **Live log streaming** brings every line of output back to your browser in real time
5. A **post-deploy health check** confirms your app is reachable
6. Optional **Docker cleanup** (prune unused images/containers) — gated behind a passing health check

---

## Docker Engine 29.x, Traefik & Redis Compatibility

Docker Engine 29.x introduced networking and build behaviour changes that break a number of common self-hosted setups — especially stacks that use **Traefik** as a reverse proxy alongside **Redis** and a Node.js app. WDP was built and tested against Docker 29.x from the ground up and handles all of these automatically, so you never have to debug them manually.

### Traefik image vs Docker Engine 29 API
Docker Engine 29+ rejects the old Docker API client that Traefik v3.0–v3.5 use. Traefik still starts and binds ports 80/443, but it **cannot discover containers**, so every request returns **404 page not found** while your app runs fine on the internal Docker network.

**WDP fix:** Generated compose files pin **`traefik:v3.6.7`** (v3.6.1+ required). Pre-deploy checks flag outdated images. Each deploy auto-upgrades stale `traefik:v3.0` lines in your compose file and verifies Traefik logs after `up` — if the API mismatch persists, the deploy fails with an explicit error instead of leaving a broken site.

### Traefik ignores “unhealthy” app containers
Traefik v3 skips containers whose Docker `HEALTHCHECK` is failing. A bad probe (e.g. `/health` when the app only serves `/`) marks the app **unhealthy**, Traefik drops all routes, and the site shows **404 page not found** even though the app process is fine.

**WDP fix:** The generated `HEALTHCHECK` probes `http://localhost:3000/` (not `/health`). With Traefik enabled, compose also sets `allowEmptyServices` so routing does not vanish during the start-period.

### External network not found
Traefik requires a pre-existing external Docker network (e.g. `traefik-public`) to be present on the remote host before `docker compose up` can succeed. Docker 29.x does not auto-create external networks declared in a compose file — it simply errors out.

**WDP fix:** Before every deploy, WDP automatically runs `docker network create traefik-public` on the remote host. If the network already exists the command is silently ignored. You never see this error.

### Shared staging server (existing Traefik)
Many teams run **one Traefik** on a VPS for several staging apps, each with its own public URL. WDP’s default mode deploys a **new** Traefik on ports 80/443 per project — that can disrupt other sites.

**WDP fix:** In **Step 5 → Traefik**, choose **Use existing Traefik**. WDP generates routing labels for your app, joins the **Docker network** you specify (e.g. `traefik-public` or `wappler-compose_proxy`), and does **not** start another Traefik or release ports 80/443 during deploy. Set **Cert resolver name** to match your server’s Traefik config. Regenerate files (Step 8) after changing mode. Pre-deploy checks block deploy if no running Traefik is found on that network (avoids removing your only proxy on a dedicated droplet).

### Port conflict on re-deploy
If a previous Traefik (or any other) container is still holding ports 80 and 443, Docker 29.x refuses to start a new one with *"port already allocated"*. This is particularly common when re-deploying after a failed first attempt or when `--force-recreate` is in play.

**WDP fix:** WDP uses `--force-recreate` on every deploy so containers are always replaced cleanly. If the deploy still fails due to a port conflict, WDP automatically runs `docker compose down` followed by a targeted stop of any container holding ports 80 or 443, then retries the deploy — no manual intervention needed. **External Traefik mode** skips releasing 80/443 so other staging apps stay up.

### Traefik SSL and routing misconfiguration
A common problem with self-managed Traefik stacks is a mismatch between the cert resolver name used in Docker labels (e.g. `letsencrypt` vs `leresolver`) and the challenge type (`tlschallenge` vs `http`). Docker 29.x does not surface these mismatches as errors — Traefik silently fails to obtain certificates, leaving the site unreachable over HTTPS.

**WDP fix:** The cert resolver name, challenge type, and network name are all read from your Step 5 configuration and injected consistently into *both* the Traefik service definition and the app service labels. For HTTP-01 (the default), WDP does **not** use an entrypoint-wide HTTP→HTTPS redirect (that blocks ACME on port 80); instead it uses a per-router redirect middleware after certificates can be issued.

### Apex and www both use HTTPS (default)
By default, Traefik routes and requests a Let's Encrypt certificate for **both** your apex domain (e.g. `example.com`) and `www.example.com` on the same app. You need DNS **A or CNAME records for both** pointing at the server. Step 5 includes **Also secure www** (on by default); turn it off only if you do not use `www`.

### Compose variable interpolation (DOMAIN / ACME_EMAIL)
In Docker Compose, variables like `${DOMAIN}`, `${TRAEFIK_ALT_HOST}`, and `${ACME_EMAIL}` used in the compose file itself (e.g. in Traefik labels) are resolved at **compose parse time** — not injected into containers. This means a service-level `env_file:` has no effect on them. Docker 29.x is stricter about unresolved variables and will warn or error rather than silently leaving them blank.

**WDP fix:** WDP passes `--env-file .env.deploy` as a **global** flag to `docker compose` (before the subcommand), ensuring all compose-level variable substitutions are resolved correctly before any service starts.

### SSH transport and host key verification
Deploying to a remote Docker host via `DOCKER_HOST=ssh://` requires the SSH binary to handle host key verification non-interactively. With Docker 29.x and recent OpenSSH versions, the default strict host key checking will cause the connection to fail immediately if the remote host is not already in `~/.ssh/known_hosts` inside the container.

**WDP fix:** WDP generates a temporary SSH wrapper script for each deployment that forces `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` on the command line — overriding any SSH config file. The wrapper is discarded after the deploy completes and no permanent changes are made to your SSH configuration.

---

## Multiple Profiles

Every project supports multiple independent named profiles. Each profile has its own:
- Wizard configuration
- Generated deployment files
- Deployment history
- SSH target

Switch between `staging` and `production` from the dashboard with one click. Profiles can be duplicated, renamed, and exported as a `.zip`. A **deploy activity heatmap** (GitHub-style, last 52 weeks) shows fleet-wide habits on the main dashboard and per-profile detail on the History tab.

---

## AI Assistant

WDP includes an optional AI assistant (powered by OpenRouter — you bring your own API key). It's scoped specifically to WDP and your project — it knows your deployment configuration and can answer questions about your stack, troubleshoot deploy errors, and explain what the generated files do.

The assistant also supports **Project Knowledge** — it can analyse your codebase and build a structured knowledge base that it draws on when answering questions about your specific app.

---

## SSH Terminal

Every profile with an SSH target gets a built-in browser terminal. Connect directly to your server without leaving the WDP UI — useful for checking logs, running one-off commands, or investigating a failed deploy.

---

## Security & Auth

WDP is designed to run on your local machine or a private server — **not** exposed to the public internet. It requires an admin password from the very first run. All routes and WebSocket connections are protected behind session authentication. If it detects it's bound to `0.0.0.0`, it shows a clear warning.

---

## Deployment History & Rollback

Every deploy is recorded with its outcome, **when it ran** (date/time and relative time, e.g. “2 hours ago”), **how long it took** (labelled “Deploy took …”), log output, and a snapshot of the generated files at deploy time. If something goes wrong, you can roll back to any previous deployment with one click.

**Docker cleanup** (optional): after a successful deploy, run a health check on the **Deploy** tab; if it passes, you can run `docker system prune` on the target host (dangling only or all unused resources). This is not on the History or Settings tabs.

---

## Requirements

To run WDP itself:
- **Docker Desktop** (Mac/Windows) or **Docker Engine** (Linux)

To deploy your project:
- A target server with Docker 24+ and Docker Compose v2+ installed (DigitalOcean currently ships **Docker Engine 29.x** — fully supported)
- SSH access to the server (key-based auth)
- A domain pointing to the server (if using Traefik + SSL) — configure **A records or nameservers at your registrar** before deploy; Step 5 shows a guided panel; Server → DNS helps verify/fix records on DigitalOcean

---

## Built by Cheese · For the Wappler Community

WDP was created to complement Wappler's deployment with a fully customisable, transparent, production-ready pipeline — for developers who want to take things further.

It's free to use on your own infrastructure, and shared with ❤️ for everyone in the Wappler community who's ever stared at a failed deployment log wondering what went wrong.

**[Mr Cheese Extension License v1.0](https://www.mrcheese.co.uk/extension-license)** · Contributions welcome · [Wappler Community](https://community.wappler.io)

---

*Current version: v1.0.0*
