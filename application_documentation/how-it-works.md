# How WDP works

WDP deploys **Wappler Node.js** projects (Server Connect with `package.json`). It does not generate LAMP/PHP-only stacks in the current beta — see [about.md → Supported project types](about.md#supported-project-types).

## Two things in Docker Desktop

| What | Container | Purpose |
|------|-----------|---------|
| **WDP** | `wdp` | Wizard & deploy UI at **http://localhost:8900** |
| **Your Wappler apps** | e.g. `myproject-development-web-1` | The sites you build |

---

## How you start WDP

```text
docker compose up -d --build
```

No `.sh` or `.bat` install scripts.

---

## Your home folder is mounted on purpose

The `wdp` container mounts **`${HOME}` → `${HOME}`** so that in the WDP UI you can:

- Browse to any Wappler project on your machine
- Use SSH keys under `~/.ssh/`
- Use the same paths you see in your file manager

WDP also uses the Docker socket so it can run **local** `docker compose` deploys (same engine as Wappler).

---

## Where settings are stored

Profiles and login live in the **`wdp-data`** Docker volume — not in the application zip. Replacing the WDP files does not delete profiles.

**Guides in the app:** after login, open **Help** from the header (install, beta, remote server troubleshooting, updating WDP).

---

## Stop WDP

```text
docker compose down
```
