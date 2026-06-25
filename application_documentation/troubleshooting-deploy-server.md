# Troubleshooting the deploy server

WDP deploys over SSH and runs `docker compose` on **your** server (VPS or DigitalOcean Droplet). The machine must have **real Docker Engine** and **Compose v2**, not Podman pretending to be Docker.

Check readiness in the WDP UI:

- **Help → Deploy server (Docker / Podman)** (in-app guide)
- **Profile → Server → Remote server readiness** (DigitalOcean)
- **Wizard Step 4** after entering SSH details (optional; you can skip)
- **Deploy → Run checks** before deploy

---

## Docker not found

**Symptom:** Pre-deploy check says Docker not found, or deploy fails with `docker: command not found`.

**Cause:** Plain Ubuntu/Debian images (including new DigitalOcean Droplets you create in the DO console) do not include Docker by default.

**Fix:**

1. In WDP: **Help** → troubleshooting guide, or **Step 4 / Server** tab → **Install Docker Engine** (Ubuntu/Debian only), or
2. SSH to the server and install manually:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Use `noble` codename on Ubuntu 24.04, `jammy` on 22.04.

**Note:** WDP auto-installs Docker only when **it creates** the Droplet (provision mode). **Import existing Droplet** does not run cloud-init.

---

## Podman instead of Docker

**Symptom:** `docker --version` shows Podman, or pre-deploy reports Podman / podman-docker.

**Cause:** Some images ship `podman-docker`, which provides a `docker` command that is not Docker Engine.

**Fix:**

```bash
sudo apt-get remove -y podman-docker podman
```

Then install Docker CE (see above) or use **Install Docker Engine** in WDP.

---

## unknown flag: --progress

**Symptom:** Deploy log contains `unknown flag: --progress` during `docker compose`.

**Cause:** Compose v1 or an old plugin on the server. WDP runs `docker compose --progress plain`.

**Fix:** Install `docker-compose-plugin` (Compose v2) from Docker's apt repository. Upgrade Docker CE if the engine is older than 24.

---

## apt: held broken packages / docker-ce not available

**Symptom:** Docker install fails with held packages or wrong package names.

**Common causes:**

- Wrong apt codename (e.g. `focal` repo on Ubuntu 24.04 `noble`)
- `apt-mark hold` on docker packages
- Mixed `docker.io` and `docker-ce`

**Fix:**

```bash
sudo apt-mark unhold docker-ce docker-ce-cli containerd.io docker-compose-plugin 2>/dev/null || true
sudo dpkg --configure -a
sudo apt-get -f install
```

Ensure `/etc/apt/sources.list.d/docker.list` uses the correct `VERSION_CODENAME` from `/etc/os-release`.

---

## SSH key problems

**Symptom:** SSH authentication fails in checks or deploy.

**Fix in WDP:**

- Use **browse** (folder button) to pick the private key file, not a pasted path
- Key must be readable inside the WDP container (home folder mounted)
- Do not select the `.pub` file; choose the private key

Profile **Settings → SSH connection** can update host, user, and key after the wizard.

---

## When WDP provisions a new Droplet

Provision mode uses cloud-init to install Docker. If deploy still fails:

1. Wait a few minutes after first provision
2. Check **Server → Remote server readiness**
3. On the server: `sudo tail -50 /var/log/cloud-init-output.log`

---

## Related docs

- [installation.md](installation.md) (WDP itself)
- [updating-wdp.md](updating-wdp.md)
- [how-it-works.md](how-it-works.md)
