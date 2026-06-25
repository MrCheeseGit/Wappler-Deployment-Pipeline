# Redis in production

Wappler can use Redis for sessions, caching, and Server Connect actions. **Wappler Project Target Options** and **Server Connect Redis** settings apply to **local development**. For a WDP production deploy, configure Redis in **Wizard Step 5** so the generated `docker-compose.deploy.yml` and `.env.deploy` match what your app expects at runtime.

---

## Wappler Redis vs WDP Redis

| Layer | What it controls |
|--------|------------------|
| **Wappler** (target options, Server Connect) | Dev Docker / local workflow |
| **WDP Step 5** | Production: Redis container (or connection string) + `REDIS_URL` in `.env.deploy` |

Enabling Redis in Wappler does **not** automatically deploy Redis for production. If your app uses Redis at runtime, enable the **Redis** add-on in Step 5 and choose a **production Redis source**.

WDP writes:

- `REDIS_URL` — full connection URL (includes password and DB index when set)
- `REDIS_PASSWORD` — when a password is configured

Your deployed Node app must read these variables (most Wappler Redis setups do when `NODE_ENV=production`).

---

## Choose a production Redis source (Step 5)

### Deploy Redis with this stack (managed)

Use when:

- This is a new production deploy
- You want WDP to run `redis:7-alpine` in the same compose stack as the app
- The app connects to hostname `redis` on the internal Docker network

Requirements:

- Set a strong password
- Confirm the acknowledgment checkbox
- Regenerate files in **Step 8** and redeploy

WDP does **not** import session or cache data from another Redis instance.

### Use existing Redis on this server

Use when:

- You already deployed Redis via Wappler or another compose project on the same VPS
- You want the app to use that instance instead of starting a second one

Steps:

1. In Step 5, choose **Use existing Redis on this server**
2. Click **Scan server for Redis containers** (requires Step 4 SSH details)
3. Set **Redis host** to the container name (e.g. `myproject-redis-1`)
4. If Redis runs in another compose project, set **Docker network** to that project's network (e.g. `wappler-compose_default`). The app container joins that network at deploy time.
5. Enter the Redis password if `requirepass` is enabled
6. Regenerate Step 8 and redeploy

**Important:** `localhost` inside the app container is **not** your server's Redis. Use the Docker container name or a reachable hostname.

### External managed Redis

Use when:

- You use cloud Redis (Upstash, DigitalOcean Managed Redis, etc.)

Enter the cloud hostname, port, password, and DB index. WDP does not start a Redis container; it only writes `REDIS_URL` to `.env.deploy`.

---

## Common symptoms

### Site loads, then HTTP 500

Often Redis connects only after the first request (sessions, cache, Server Connect).

Check on the server:

```bash
docker compose -f docker-compose.deploy.yml logs app --tail=100
docker compose -f docker-compose.deploy.yml exec app printenv | grep REDIS
```

| Log / error | Likely cause |
|-------------|----------------|
| `ECONNREFUSED 127.0.0.1:6379` | Redis add-off or app ignoring `REDIS_URL`; still pointing at localhost |
| `ENOTFOUND redis` | Redis add-on off but app expects Docker hostname `redis` |
| `NOAUTH` / `WRONGPASS` | Password mismatch between Step 5 and the Redis instance |
| Errors only on some pages | Server Connect Redis actions or session middleware |

### Different errors when Redis add-on is on vs off

- **Off:** App still expects Redis but nothing is reachable at the configured host
- **On (managed):** New Redis with Step 5 password; app may still use old Wappler dev settings unless it reads `REDIS_URL`

Fix: pick the correct Step 5 mode, align host/password, regenerate Step 8, redeploy.

---

## Database (Step 3) — related note

If your app uses a **cloud or existing database**, choose **I already have a database** in Step 3 (External or self-hosted), not **Skip database in WDP**. Skip means WDP does not write any `DB_*` variables.

If you want WDP to run a **new** Postgres/MySQL container, choose **WDP runs a new DB container** and confirm the managed-database notice.

---

## Checklist before deploy

- [ ] Step 5 Redis mode matches your server (managed / existing / external)
- [ ] Password and DB index match the real Redis instance
- [ ] For existing Redis: container name and Docker network are correct
- [ ] **Step 8** regenerated after any Step 5 change
- [ ] Pre-deploy checks pass (Redis configuration, managed DB acknowledgment if applicable)
- [ ] Redeploy after regenerating files

---

## See also

- [How it works](how-it-works.md) — wizard overview
- [Troubleshooting the deploy server](troubleshooting-deploy-server.md) — Docker / SSH on the VPS
