# Wappler Deployment Pipeline (WDP)

A free deployment tool that helps **Wappler** developers containerise and deploy Node.js apps to **your own** servers — wizard, generated Docker files, security scanning, and DigitalOcean/VPS tooling.

**Beta** — feedback welcome. See [Beta guide](application_documentation/beta.md) and [Changelog](CHANGELOG.md).

**Docs:** In the app, open **Help** (header link) · or on disk: [How it works](application_documentation/how-it-works.md) · [Install](application_documentation/installation.md) · [Update WDP](application_documentation/updating-wdp.md) · [Deploy server troubleshooting](application_documentation/troubleshooting-deploy-server.md) · [Full overview](application_documentation/about.md)

---

## Beta testers — install from GitHub

**Requirements:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Mac/Windows) or Docker Engine (Linux).

```bash
git clone https://github.com/MrCheeseGit/Wappler-Deployment-Pipeline.git
cd Wappler-Deployment-Pipeline
docker compose up -d --build
```

Open **http://localhost:8900** and complete first-run setup (admin username + password).

| What you get | Where |
|--------------|--------|
| WDP web UI | Container **`wdp`**, port **8900** |
| Profiles & settings | Docker volume **`wdp-data`** (survives container rebuilds) |
| Your Wappler projects | Same paths on disk — browse via mounted **home folder** |

**Stop WDP:** `docker compose down` (your app containers are not removed).

**Windows:** use a WSL2 terminal with Docker Desktop integration. If `HOME` is missing, copy [`.env.example`](.env.example) to `.env` and set `HOME` — see [installation.md](application_documentation/installation.md).

**No install scripts** — only Docker Compose.

---

## Important — Wappler and Docker (please read)

WDP is designed to run **alongside the Wappler IDE** on the same machine. Both use **Docker Desktop** (or Engine) for local development and deploys.

On **some setups**, especially **Docker Desktop on Mac or Windows**, you may see Wappler **Server Actions spin indefinitely** (loading cog) — for example when connecting or browsing **API directories** — **while the `wdp` container is running**.

This is a **known beta limitation**: WDP’s container needs access to the Docker API (via `docker.sock`) and your home folder so you can browse projects and SSH keys. That combination can contend with Wappler on certain Docker Desktop versions. There is **no widely documented fix yet**; we are actively working on it.

**What to try if Wappler spins:**

1. Confirm it is WDP-related: `docker compose down`, reload Wappler — if Server Actions work again, it is the coexistence issue.
2. Use WDP only when deploying; stop WDP (`docker compose down`) while doing heavy Server Action / API work in Wappler.
3. Restart Docker Desktop, then start WDP again.
4. See [installation.md → Wappler troubleshooting](application_documentation/installation.md#wappler-server-actions-spin-or-hang) for more detail.

**Please report** your OS, Docker Desktop version, and Wappler version when you hit this — it helps us prioritise a proper fix.

WDP does **not** modify your Wappler project files; it only adds optional `wdp/{profile}/` deploy artefacts (and can merge them into `.gitignore`).

---

## Supported projects (important)

WDP targets **Wappler projects that run on Node.js** — typically **Server Connect** apps with a root **`package.json`** and a Node entry point (generated images use `node index.js` on port **3000**).

| Supported now | Not supported yet |
|---------------|-------------------|
| Wappler + **Node.js** / Server Connect | **LAMP** (Apache + PHP + MySQL) as a generated stack |
| Projects with **`package.json`** at the project root | PHP-only or static sites **without** a Node `package.json` |
| Optional add-ons (Traefik, Redis, etc.) on Docker | Other runtimes unless you maintain your own `Dockerfile` by hand |

Wappler’s **built-in deployment** remains the right choice for many targets. Use WDP when you want a **Node** production pipeline you control. More detail: [about.md → Supported project types](application_documentation/about.md#supported-project-types).

---

## Quick start (zip download)

If you received a zip instead of cloning:

1. Unzip the folder.
2. Open a terminal in that folder.
3. Run `docker compose up -d --build`.
4. Open **http://localhost:8900**.

---

## Publishing this repo (maintainers)

Before the first push to GitHub:

1. **Initialize git** (if not already):  
   `git init` → `git add .` → `git commit -m "Initial beta release"`  
   Do **not** commit `.env`, `node_modules/`, or local `data/` — see [`.gitignore`](.gitignore).

2. **License** — root [`LICENSE`](LICENSE) ([Mr Cheese Extension License v1.0](https://www.mrcheese.co.uk/extension-license)) is included; keep it in the repo.

3. **Secrets** — profiles and API keys live in the **`wdp-data`** volume (`wdp-config.json`), not in git. Never commit `.env` (`.env.example` is safe and should be committed).

4. **Set beta expectations** — ensure this README (Wappler + Docker section) and [beta.md](application_documentation/beta.md) are on the default branch so testers see the Server Actions note immediately.

Create the empty repository on GitHub first (see below), then push this project to it.

---

## Documentation

| Document | Audience |
|----------|----------|
| **In-app Help** (`/help` after login) | Install, beta, deploy-server troubleshooting, updating WDP |
| [how-it-works.md](application_documentation/how-it-works.md) | What runs in Docker (WDP vs your apps) |
| [installation.md](application_documentation/installation.md) | Platforms, paths, troubleshooting |
| [updating-wdp.md](application_documentation/updating-wdp.md) | Git pull / zip update steps |
| [troubleshooting-deploy-server.md](application_documentation/troubleshooting-deploy-server.md) | Podman, Compose, Docker install on remote servers |
| [beta.md](application_documentation/beta.md) | Beta scope and feedback |
| [about.md](application_documentation/about.md) | Product overview, Traefik / Docker 29 |

---

## Licence

[Mr Cheese Extension License v1.0](https://www.mrcheese.co.uk/extension-license) — see [LICENSE](LICENSE). Free to use on your own infrastructure; redistribution requires written permission from [info@mrcheese.co.uk](mailto:info@mrcheese.co.uk). Built for the [Wappler community](https://community.wappler.io).
