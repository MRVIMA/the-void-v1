import config, { validateConfig } from './config.js';
import { banner, log, logger } from './lib/logger.js';
import { sweepTmp } from './lib/media.js';
import { initStore } from './store/index.js';
import { loadCommands, commands } from './core/registry.js';
// Passive features register themselves on import (anti-link, word filter).
import './features/moderation.js';
import './features/autoreply.js';
import { connect, shutdownSocket } from './core/socket.js';
import { startServer } from './web/server.js';
import { installSignalLogFilter } from './lib/console-filter.js';

const boot = log('boot');

// Must be installed before the WhatsApp socket processes any Signal sessions.
installSignalLogFilter();

async function main() {
  /* 1 — configuration must be sane before anything touches the network */
  const { fatal, warn } = validateConfig();
  for (const w of warn) boot.warn(w);
  if (fatal.length) {
    boot.error('Cannot start — fix the following in your .env file:');
    for (const f of fatal) boot.error(`  • ${f}`);
    process.exit(1);
  }

  /* 2 — liveness must not wait on MongoDB, imports, or WhatsApp. Railway
   * starts probing immediately and should see that the process is alive while
   * slower dependencies initialize. Readiness remains 503 until connected. */
  const server = startServer();

  /* 3 — storage, so settings exist before the first message arrives */
  const store = await initStore();

  /* 4 — commands */
  await loadCommands();

  banner([
    `${config.BOT_NAME}`,
    '',
    `prefix    ${config.PREFIX}`,
    `mode      ${config.MODE}`,
    `store     ${store.driver}`,
    `commands  ${commands.size}`,
    `port      ${config.PORT}`,
  ]);

  /* 5 — WhatsApp */
  const sock = await connect();

  /* housekeeping */
  const sweeper = setInterval(() => sweepTmp().catch(() => {}), 30 * 60 * 1000);
  sweeper.unref();

  /**
   * Keepalive for free hosting tiers that suspend idle instances.
   *
   * Suspension drops the WhatsApp socket, so a periodic request keeps the
   * instance warm. Only runs when PUBLIC_URL is set — on a VPS or any
   * always-on host it is pure noise and stays off. Note that some platforms
   * only count external traffic, so this is a mitigation, not a guarantee.
   */
  let keepalive;
  if (config.PUBLIC_URL) {
    const url = new URL('/live', config.PUBLIC_URL).href;
    keepalive = setInterval(() => {
      fetch(url).catch((err) => boot.debug({ err: err.message }, 'keepalive ping failed'));
    }, 4 * 60 * 1000);
    keepalive.unref();
    boot.info({ url }, 'keepalive enabled');
  }

  /* graceful shutdown so the session is never left half-written */
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    boot.info({ signal }, 'shutting down');
    clearInterval(sweeper);
    clearInterval(keepalive);
    server.close();
    const handlersDrained = await shutdownSocket(sock);
    if (handlersDrained) {
      await store.close?.();
    } else {
      // Closing Mongo while a handler still owns an operation produces
      // MongoClientClosedError. Let process teardown close it instead.
      boot.info('a long-running command is still stopping; storage will close with the process');
    }

    /**
     * Do not call process.exit() here.
     *
     * In development the logger writes through a pino-pretty worker thread.
     * Exiting while that worker is mid-close makes libuv abort with
     * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" — an ugly crash
     * dump in place of a clean shutdown. Setting exitCode lets the loop drain
     * naturally; every interval we own is unref'd, so this exits promptly.
     * The unref'd timer below is the backstop: it cannot hold the process open
     * by itself, but fires if some other handle is still lingering.
     */
    process.exitCode = 0;
    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * A WhatsApp bot lives on a flaky network and talks to a dozen third-party
 * scrapers. Crashing the process on a single rejected promise means downtime,
 * so we log loudly and keep serving.
 */
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason instanceof Error ? reason.stack : String(reason) }, 'unhandled rejection');
});

process.on('uncaughtException', (err) => {
  const message = String(err?.message ?? err);
  // Transient socket noise from Baileys — not worth a restart.
  if (/Socket connection timeout|Connection Closed|rate-overlimit|Timed Out/i.test(message)) {
    logger.warn({ err: message }, 'recoverable socket error');
    return;
  }
  logger.fatal({ err: err.stack }, 'uncaught exception');
});

main().catch((err) => {
  logger.fatal({ err: err.stack }, 'failed to start');
  process.exit(1);
});
