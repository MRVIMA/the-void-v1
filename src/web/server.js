import express from 'express';
import QRCode from 'qrcode';
import config from '../config.js';
import { log } from '../lib/logger.js';
import { uptime } from '../lib/format.js';
import { commands } from '../core/registry.js';
import { state } from '../core/socket.js';

const logger = log('web');

/**
 * Small status server. Two jobs: give hosting platforms a health check to ping,
 * and render the pairing QR in a browser for headless deploys where nobody can
 * see the terminal.
 */
export function startServer() {
  const app = express();
  app.disable('x-powered-by');

  /**
   * Liveness — is the process up? Always 200.
   *
   * This is what a platform health check must point at. Pointing a restarting
   * health check at /health instead means a fresh deploy gets killed before
   * anyone can scan the QR, and the bot can never finish linking.
   */
  app.get('/live', (_req, res) => {
    res.status(200).json({ status: 'alive', uptime: uptime() });
  });

  /** Readiness — is WhatsApp actually linked? 503 until it is. */
  app.get('/health', (_req, res) => {
    res.status(state.connected ? 200 : 503).json({
      status: state.connected ? 'connected' : 'disconnected',
      uptime: uptime(),
      commands: commands.size,
    });
  });

  app.get('/', async (_req, res) => {
    if (state.connected) {
      return res.type('html').send(page('Connected', `<p class="ok">Linked as ${escape(state.user?.name || state.user?.id || 'unknown')}</p>`));
    }
    if (!state.qr) {
      return res.type('html').send(page('Waiting', '<p>No QR yet. Check the logs — the bot may be starting or already paired.</p>'));
    }
    const svg = await QRCode.toString(state.qr, { type: 'svg', margin: 1, width: 300 });
    res.type('html').send(page('Scan to link', `<div class="qr">${svg}</div><p>WhatsApp → Linked devices → Link a device</p>`));
  });

  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'status server listening'));
  return server;
}

const escape = (s = '') => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(config.BOT_NAME)} — ${escape(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; display: grid; place-items: center;
         min-height: 100vh; margin: 0; background: Canvas; color: CanvasText; text-align: center; }
  main { padding: 2rem; }
  .qr { background: #fff; padding: 1rem; border-radius: 12px; display: inline-block; }
  .ok { color: #16a34a; font-weight: 600; }
  p { opacity: .8; }
</style></head>
<body><main><h1>${escape(config.BOT_NAME)}</h1>${body}</main></body></html>`;

export default startServer;
