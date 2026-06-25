# WDP — Beta tester guide

Read **[how-it-works.md](how-it-works.md)** first, then the **Wappler + Docker** section in the [repository README](../readme.md#important--wappler-and-docker-please-read).

---

## Install from GitHub

**Requirements:** Docker Desktop (Mac/Windows) or Docker Engine (Linux).

```bash
git clone https://github.com/MrCheeseGit/Wappler-Deployment-Pipeline.git
cd Wappler-Deployment-Pipeline
docker compose up -d --build
```

Open **http://localhost:8900**. No install scripts.

Your **home folder** is mounted into the container so you can browse to projects and `~/.ssh` in the wizard.

| Platform | Run `docker compose` from |
|----------|---------------------------|
| Linux | Terminal in the cloned folder |
| macOS | Terminal.app in the cloned folder |
| Windows | WSL2 terminal (Docker Desktop) |

**Stop:** `docker compose down`

---

## Known beta limitation — Wappler Server Actions

If **Wappler Server Actions** (spinning cog) hang while WDP is running — especially on **API / Server Connect directories** — you are not alone. This can happen when WDP and Wappler both use Docker Desktop on the same machine.

**Quick check:** `docker compose down` → retry in Wappler. If that fixes it, see the README and [installation.md → Wappler](installation.md#wappler-server-actions-spin-or-hang).

**Please report:** OS, Docker Desktop version, Wappler version, and whether stopping WDP fixes the spin.

---

## Traefik — dedicated server vs shared staging

In **Wizard Step 5 → Traefik** (remote/VPS/DigitalOcean only), choose the mode that matches your server:

| Mode | When to use |
|------|-------------|
| **Deploy Traefik with this stack** (default) | One app per Droplet, or WDP should own ports **80/443** on that server (e.g. your own `mrcheese.co.uk` VPS). |
| **Use existing Traefik** | A **shared** staging box where Traefik already routes several apps. WDP only adds your app to the proxy network — it does **not** start another Traefik. |

After changing mode, always **regenerate (Step 8)** and run **pre-deploy checks** before deploy. If you pick **Use existing Traefik** but no Traefik is running on that host, checks will fail (this prevents taking the site offline).

More detail: [about.md → Shared staging server](about.md#shared-staging-server-existing-traefik).

---

## Node.js only (for now)

WDP generates Docker files for **Wappler Node / Server Connect** projects (`package.json`, `node index.js`, port **3000**). It does **not** yet generate **LAMP**, PHP-only, or other non-Node stacks. If your folder has no `package.json`, Step 1 will not treat it as a valid WDP project.

Details: [about.md → Supported project types](about.md#supported-project-types).

---

## What we need from you

- What broke, steps to reproduce, and screenshots if possible
- Whether Wappler was open while WDP ran, and whether Server Actions spun
- Hosting target (local Docker, VPS, DigitalOcean)

---

## Wizard — Step 2 vs Step 4 (existing Droplets)

- **Step 2** is about how your **app** is built in Docker — not the Droplet's Ubuntu version.
- **Step 4** is where you link an **existing** DigitalOcean Droplet or enter VPS SSH details. WDP shows the **detected host OS and CPU** and does **not** change them on deploy.
- If Docker is missing or you have **Podman** instead of Docker Engine, use the optional readiness banner on **Step 4** (check, **Install Docker Engine**, or **Skip for now**) or **Server → Overview** after saving the profile.

Server setup help: **Help → Deploy server (Docker / Podman)** in the app, or [troubleshooting-deploy-server.md](troubleshooting-deploy-server.md)

---

## What beta means

- Real features, but APIs and copy may change
- Deploy to **staging** first; keep backups
- Data stays in Docker volume **`wdp-data`**

Full troubleshooting: [installation.md](installation.md)
