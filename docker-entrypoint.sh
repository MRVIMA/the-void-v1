#!/bin/sh
set -e

# Platform volumes (Railway, Fly, Docker named volumes) are mounted owned by
# root. The bot runs as the unprivileged `node` user and must be able to write
# its WhatsApp session, so when we start as root we take ownership of the
# writable paths and then drop privileges before exec'ing the app.
#
# Running as root the whole time would be simpler and wrong: a compromised
# scraper dependency would then own the container.

if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/session /app/data 2>/dev/null || true

  if command -v gosu >/dev/null 2>&1; then
    exec gosu node "$@"
  elif command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=node --regid=node --init-groups "$@"
  else
    echo "entrypoint: no privilege-dropping tool available, staying as root" >&2
    exec "$@"
  fi
fi

# Already unprivileged (plain `docker run` with no volume, or a platform that
# sets the user itself) — nothing to do.
exec "$@"
