# Updating WDP

WDP runs as a Docker container built from the files in your WDP folder. To get a newer version, update those files on your **host machine**, then rebuild the image.

Your **deployment profiles** and settings are stored in the Docker volume **`wdp-data`**. Rebuilding WDP does not remove them.

---

## Check for updates in the UI

Open **Settings** or the **Dashboard**. When a newer release exists on GitHub, WDP shows a banner with copy-paste steps.

The **About** dialog shows your running version and links to the latest release when an update is available.

---

## Git clone install

From the folder where you cloned WDP:

```text
cd /path/to/Wappler-Deployment-Pipeline
git pull
docker compose up -d --build
```

Open **http://localhost:8900** and sign in as usual.

---

## Zip download install

If you installed from a zip package:

```text
docker compose down
```

Replace the WDP files with the new download. Keep **`.env`** if you created one from `.env.example`.

```text
docker compose up -d --build
```

---

## Offline or no GitHub access

If the update check cannot reach GitHub, the UI still shows your **current version** from `backend/package.json` inside the running container. Compare it with [releases on GitHub](https://github.com/MrCheeseGit/Wappler-Deployment-Pipeline/releases) manually.

---

## After updating

1. Reload the browser tab.
2. Open **About** to confirm the new version.
3. Run **Deploy → Run checks** on an active profile if you use remote SSH deploys.

See also [installation.md](installation.md) for first-time setup.
