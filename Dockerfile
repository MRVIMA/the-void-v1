# Debian slim rather than Alpine: sharp's prebuilt binaries and the yt-dlp
# standalone build both expect glibc, and fighting musl here saves nothing.
FROM node:24-slim

# tini reaps the ffmpeg/yt-dlp child processes the bot spawns. Without an init
# process those become zombies and eventually exhaust the process table.
# gosu drops privileges in the entrypoint after fixing volume ownership.
# youtube-dl-exec installs yt-dlp's Unix launcher, which requires Python both
# during npm installation and whenever the bot invokes yt-dlp.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates gosu python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so edits to src/ don't invalidate the install layer.
# This step downloads the ffmpeg (~80 MB) and yt-dlp (~18 MB) binaries.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY assets ./assets

# Writable state. Mount a volume at /app/session or the WhatsApp login is lost
# on every redeploy and you will be re-scanning the QR each time.
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/session /app/data \
    && chown -R node:node /app

# Deliberately no `USER node` here. The container starts as root so the
# entrypoint can chown a freshly mounted volume, then drops to `node` before
# running the bot. Without that step a Railway volume stays root-owned and the
# session cannot be written.

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

# Liveness, not readiness. /live is always 200 while the process runs; /health
# reports 503 until WhatsApp is linked. A restarting health check must never
# point at /health or a fresh deploy is killed before the QR can be scanned.
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
