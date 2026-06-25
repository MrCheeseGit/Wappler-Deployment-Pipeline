# Installing WDP

WDP is a Docker application. Users only run **`docker compose`** — no install scripts.

---

## Requirements

- Docker Desktop (Mac/Windows) or Docker Engine (Linux)
- A browser
- A **Wappler Node.js** project with **`package.json`** at the project root (Server Connect). LAMP/PHP-only projects are not supported by the wizard yet — see [about.md → Supported project types](about.md#supported-project-types).

---

## Install

1. Unzip the WDP package.
2. Open a terminal **in that folder** (Terminal on Mac, WSL on Windows, any terminal on Linux).
3. Run:

```text
docker compose up -d --build
```

4. Open **http://localhost:8900**

You should see container **`wdp`** and volume **`wdp-data`** in Docker Desktop.

---

## Paths and browsing

Your **entire home directory** is mounted into the container. In the wizard you can browse to:

- Wappler projects (e.g. `/home/you/projects/MyApp` or `/Users/you/Documents/MyApp`)
- SSH keys (e.g. `~/.ssh/id_ed25519`)

Use the **same absolute paths** you would use in Wappler.

---

## macOS

Run `docker compose up -d --build` from Terminal in the WDP folder. `HOME` is set automatically.

---

## Windows (Docker Desktop)

Use a terminal where `HOME` is defined (usually **WSL2**). If compose reports an empty `HOME`, copy `.env.example` to `.env` and set:

```env
HOME=/home/yourwsluser
```

Use WSL paths in the wizard (`/mnt/c/Users/...` if the project is on drive C:).

---

## After a new zip from us

See **[updating-wdp.md](updating-wdp.md)** for git and zip update steps. The WDP UI can also notify you when a newer release is on GitHub (Settings or Dashboard).

Profiles remain in **`wdp-data`** when you rebuild.

---

## Troubleshooting

For **remote deploy servers** (Docker missing, Podman, old Compose), see **Help → Deploy server** in the app or [troubleshooting-deploy-server.md](troubleshooting-deploy-server.md).

### Wappler Server Actions spin or hang

On **Docker Desktop** (especially Mac and Windows), Wappler **Server Actions** may show a **spinning cog forever** — often when working with **Server Connect / API directories** — while the **`wdp`** container is running.

WDP needs the Docker socket and your home folder mount to deploy locally and to let you browse project paths in the UI. On some machines that conflicts with how Wappler uses Docker. **This is a known beta issue** with no universal fix yet.

**Confirm WDP is involved**

```text
docker compose down
```

Reload Wappler and retry the Server Action. If it works, the conflict is WDP + Docker Desktop coexistence (not your project).

**Mitigations**

1. Stop WDP when you are not deploying: `docker compose down`
2. Restart Docker Desktop, then `docker compose up -d --build`
3. Do heavy Wappler Server Action work with WDP stopped; start WDP when you need the deploy pipeline

**Please report** (helps us fix it): operating system, Docker Desktop version, Wappler version, and whether stopping WDP clears the spin. See also the [repository README](../readme.md#important--wappler-and-docker-please-read).

### Port 8900 in use

Add to `.env`: `WDP_PORT=9900`, then `docker compose up -d --build`.

### `address already in use` on port 8900 (Linux + Docker Desktop)

You did not change your command — Docker may be using a **different context** than the one WDP is running on (`docker context show`). On Linux, **Docker Desktop** (`desktop-linux`) and **Engine** (`default`) are separate; both accept `docker compose up -d --build`, but only one can bind port 8900.

If WDP is already up in Desktop, switch context and rebuild:

```text
docker context use desktop-linux
docker compose up -d --build
```

Or: `docker --context desktop-linux compose up -d --build`

Helper (runs the check automatically): `./scripts/run.sh`

### Cannot browse to files

Confirm `HOME` is mounted: `docker inspect wdp --format '{{json .Mounts}}'`

Ensure `HOME` is set when you run compose (or set it in `.env`).
