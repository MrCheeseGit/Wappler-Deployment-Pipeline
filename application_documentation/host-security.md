# Host security and hardening (your Droplet / VPS)

WDP deploys your **app in Docker**. It does **not** yet automate OS-level hardening on the server. For public VPS hosts (DigitalOcean, etc.), you should apply a small baseline on the **host** yourself.

**In WDP today:** use **profile → Terminal** (or your normal SSH client).  
**Planned:** profile → **Server → Security** (audit, then optional one-click apply).

Host tools such as **fail2ban** and **UFW** are **not** Step 5 compose add-ons — they belong on the operating system.

---

## What to do today (manual baseline)

Run these **once per VPS** after you can SSH in. Steps assume Ubuntu/Debian; use equivalent packages on other distros.

### 1. SSH — keys only

- Prefer a non-root sudo user for daily use.  
- Install your **public key** in `~/.ssh/authorized_keys`.  
- In `/etc/ssh/sshd_config`, then `systemctl reload sshd`:

  - `PermitRootLogin prohibit-password` or `no` (once sudo user works)  
  - `PasswordAuthentication no`  
  - `PubkeyAuthentication yes`  

- **Keep a second SSH session open** before disabling password auth to avoid lockout.

- [OpenSSH manual](https://www.openssh.com/manual.html) · [DigitalOcean — recommended Droplet setup](https://docs.digitalocean.com/products/droplets/getting-started/recommended-droplet-setup/)

### 2. Firewall (UFW)

Typical Wappler + Traefik on one Droplet:

```bash
sudo apt update && sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH    # or: sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

If SSH is **not** on port 22, allow that port **before** `ufw enable`.

- [UFW (Ubuntu community help)](https://help.ubuntu.com/community/UFW)

### 3. fail2ban

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

- [fail2ban](https://github.com/fail2ban/fail2ban) · [DigitalOcean — fail2ban on Ubuntu](https://docs.digitalocean.com/tutorials/how-to-protect-ssh-with-fail2ban-on-ubuntu-20-04/)

### 4. Unattended security updates (recommended)

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

Schedule reboots when the kernel updates.

- [Debian unattended-upgrades](https://wiki.debian.org/UnattendedUpgrades)

### 5. DigitalOcean Cloud Firewall (edge)

In the DO control panel, attach a **Cloud Firewall**: restrict **22** (or your SSH port) to your IP if possible; allow **80/443** from the internet. Complements UFW.

- [DigitalOcean Cloud Firewalls](https://docs.digitalocean.com/products/networking/firewalls/)

---

## What WDP already covers vs the host

| Concern | Handled by |
|---------|------------|
| CVEs in image / `node_modules` | Wizard Step 7 + pre-deploy scan |
| TLS for your app domain | Traefik + ACME (Step 5); Server → DNS for A records |
| Secrets in git | Gitleaks; Git init `.gitignore` |
| SSH brute force, OS firewall | **You (this checklist)**; WDP Server → Security later |

---

*May 2026 — revise when in-app host security ships.*
