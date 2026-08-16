# Deploying THE VØID

The bot holds a long-lived WebSocket and stores its WhatsApp login on disk.
That rules out anything serverless, anything that sleeps when idle, and any
platform that wipes the filesystem between restarts.

**Railway is the recommended target** — it is the only mainstream Heroku-style
host in this project's price range that offers a real persistent volume, which
means the WhatsApp login simply survives restarts instead of needing to be
re-injected on every deploy.

| | Railway | Koyeb free |
|---|---|---|
| Persistent disk | Yes, volumes | No — ephemeral |
| Session survives redeploy | Yes | Only via `SESSION_ID` |
| Sleeps when idle | No (`sleepApplication: false`) | Can suspend |
| RAM | Chosen per service | ~512 MB |
| Cost | No free tier; Hobby from ~$5/mo | Free tier exists |

Railway costs money. Koyeb's free tier does not, but 512 MB makes media
commands unreliable. Both are documented below.

---

## Shared prerequisites

### 1 · Push to GitHub

Both platforms build from a Git repository.

```bash
git init -b main
```

Before committing, confirm nothing secret is staged. **This must print nothing:**

```bash
git status --porcelain --ignored=no | findstr /I ".env session data"
```

If it prints a line, stop and fix `.gitignore` first.

```bash
git add . && git commit -m "THE VOID v2"
```

Create an **empty private repo** on GitHub, then:

```bash
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
```

```bash
git push -u origin main
```

### 2 · Export your session

The volume starts empty, so the first boot needs the login handed to it.

```bash
npm start
```

Link your phone, wait for `connected to WhatsApp`, stop with `Ctrl+C`, then:

```bash
npm run export-session
```

Copy the base64 string. **That string is your WhatsApp login** — treat it as a
password. It goes into the platform's secret store, never into the repo.

---

## Railway

### Create the service

1. **New Project → Deploy from GitHub repo** → select your repo.
2. Railway reads [`railway.json`](railway.json) and builds from the Dockerfile
   automatically. No build configuration needed.

### Add the volume — do this before the first successful boot

**Service → Settings → Volumes → Add Volume**, mount path exactly:

```
/app/session
```

That path is not arbitrary: the bot resolves `SESSION_DIR` relative to `/app`
inside the container, so anything else and the session lands on the ephemeral
layer and disappears on restart.

Railway mounts volumes owned by `root`. The container starts as root purely so
[`docker-entrypoint.sh`](docker-entrypoint.sh) can take ownership of that mount
and then drop to the unprivileged `node` user before starting the bot. That is
why there is no `USER node` in the Dockerfile.

### Environment variables

**Variables** tab. Railway treats all of them as secrets at rest.

| Variable | Value |
|---|---|
| `OWNER_NUMBER` | `94768025951` |
| `BOT_NAME` | `THE VØID` |
| `OWNER_NAME` | `THE VØID` |
| `SESSION_ID` | the base64 string from above |
| `MONGO_URI` | your Atlas connection string |
| `PREFIX` | `.` |
| `MODE` | `private` |
| `TIMEZONE` | `Asia/Colombo` |
| `NODE_ENV` | `production` |

Add `GEMINI_API_KEY`, `TMDB_API_KEY`, `OMDB_API_KEY`, `OPENSUBTITLES_API_KEY`
if you have them.

Do **not** set `PORT` — Railway injects it. Do **not** set `SESSION_DIR` or
`SQLITE_PATH`; the defaults are what the volume mount path depends on.

`PUBLIC_URL` is unnecessary on Railway — it does not sleep, so the keepalive
would be pointless traffic.

### After the first successful boot

Once the logs show `connected to WhatsApp`, the login has been written to the
volume. From then on the volume is the source of truth and `SESSION_ID` is
ignored, because the bot only restores from it when no session exists on disk.

You may delete the `SESSION_ID` variable at that point. Keeping it is harmless
but it is one more copy of a credential than you need.

### Non-negotiables

- **One replica.** `railway.json` pins `numReplicas: 1`. Two instances sharing
  one WhatsApp session fight over the connection — each boot kicks the other
  off, forever. Never scale this service horizontally.
- **Health check is `/live`.** Also pinned in `railway.json`. `/health` returns
  503 until WhatsApp links, so a restarting health check aimed at it kills every
  deploy before it can finish connecting.
- **`sleepApplication: false`.** Serverless sleep drops the socket.

### Deploying updates

Push to `main`. Railway rebuilds and redeploys; the volume and the session
persist across it.

---

## Koyeb (free tier)

Same GitHub prerequisites. The differences:

1. **Create Service → GitHub**, builder **Dockerfile** (not Buildpack — the
   ffmpeg and yt-dlp binaries come from the npm install).
2. Port `8000`, health check **HTTP** on **`/live`**.
3. No volume is available, so `SESSION_ID` is **mandatory** and stays
   mandatory — it re-seeds the login on every restart.
4. Set `PUBLIC_URL` to your `https://<app>.koyeb.app` URL once assigned, so the
   keepalive stops the instance being suspended. Redeploy after adding it.

Because 512 MB is tight for ffmpeg, also set:

| Variable | Value |
|---|---|
| `DOWNLOAD_CONCURRENCY` | `1` |
| `MAX_DURATION_MIN` | `10` |
| `MAX_UPLOAD_MB` | `50` |
| `NODE_OPTIONS` | `--max-old-space-size=384` |

Settings still persist on Koyeb because they live in MongoDB, not on disk. Only
the WhatsApp session is affected by the ephemeral filesystem.

---

## Verify any deployment

```bash
curl https://YOUR-APP-URL/live
```

`{"status":"alive"}` — the process is running.

```bash
curl https://YOUR-APP-URL/health
```

`{"status":"connected"}` — WhatsApp linked. If it says `disconnected`, read the
runtime logs; a bad `SESSION_ID` logs `SESSION_ID is not a valid base64
creds.json`.

The startup banner should read `store mongodb`. If it reads `sqlite`, Atlas
refused the connection — see below.

Then message the bot `.menu`.

---

## A warning about the QR page

The bot serves a pairing QR at `/` with no authentication. On a public URL,
anyone who loads that page while the bot is unlinked can scan it and attach
your bot to **their** WhatsApp account.

Use `SESSION_ID` to link, as documented above, and the QR is never shown in
production — the bot boots already linked. Only fall back to scanning the
hosted page if you must, and treat the URL as a secret while you do.

---

## MongoDB Atlas network access

Neither platform gives you a fixed outbound IP. In Atlas → **Network Access**,
allow `0.0.0.0/0`. Your database user's password remains the real gate, but be
aware that is what you are allowing.

Symptom of getting this wrong: `MongoDB unreachable — falling back to local
SQLite` in the logs, and settings quietly resetting on every restart.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Restart loop immediately after deploy | Health check on `/health` | Point it at `/live` |
| Session lost on every redeploy | Volume missing or wrong mount path | Mount at exactly `/app/session` |
| `EACCES` writing the session | Volume root-owned, entrypoint skipped | Confirm `ENTRYPOINT` runs `docker-entrypoint.sh` |
| `no such file or directory` on the entrypoint | Script checked out with CRLF | `.gitattributes` forces LF — re-clone or re-commit |
| `SESSION_ID is not a valid base64 creds.json` | Truncated paste | Re-run `npm run export-session`, copy the whole string |
| Bot connects then drops repeatedly | More than one replica | Scale to exactly 1 |
| `store sqlite` in the banner | Atlas rejected the connection | Allow `0.0.0.0/0` in Network Access |
| OOM-killed during `.song` / `.video` | Instance too small | Lower `MAX_DURATION_MIN`, `DOWNLOAD_CONCURRENCY=1` |
| `.song` fails after weeks of working | Site changed its player | `.dlupdate` |
