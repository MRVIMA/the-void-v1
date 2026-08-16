import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from 'baileys';
import NodeCache from 'node-cache';
import qrTerminal from 'qrcode-terminal';
import config from '../config.js';
import { baileysLogger, log } from '../lib/logger.js';
import { handleMessage } from './handler.js';
import { getMessage } from './msgcache.js';
import * as group from './group.js';
import { registerEvents } from './events.js';

const logger = log('socket');

/** Latest QR string, exposed to the web server for browser-based pairing. */
export const state = { qr: null, connected: false, startedAt: Date.now(), user: null };

let reconnectAttempts = 0;

/* ── session bootstrap ───────────────────────────────────────────────────── */

/**
 * Restores credentials from SESSION_ID when the session folder is empty.
 *
 * Only a self-contained base64 blob is accepted. The original project also
 * pulled sessions from third-party URLs, which hands your account to whoever
 * runs that host — that path is deliberately not reimplemented.
 */
function restoreSession() {
  const credsPath = path.join(config.SESSION_DIR, 'creds.json');
  if (fs.existsSync(credsPath)) return false;
  if (!config.SESSION_ID) return false;

  const raw = config.SESSION_ID.includes(';') ? config.SESSION_ID.split(';').pop() : config.SESSION_ID;
  try {
    const decoded = Buffer.from(raw.trim(), 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded); // throws if this isn't real creds
    if (!parsed?.noiseKey || !parsed?.me) throw new Error('missing noiseKey/me');

    fs.mkdirSync(config.SESSION_DIR, { recursive: true });
    fs.writeFileSync(credsPath, decoded);
    logger.info('session restored from SESSION_ID');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'SESSION_ID is not a valid base64 creds.json — ignoring it');
    return false;
  }
}

/* ── connection ──────────────────────────────────────────────────────────── */

export async function connect() {
  restoreSession();
  fs.mkdirSync(config.SESSION_DIR, { recursive: true });

  const { state: authState, saveCreds } = await useMultiFileAuthState(config.SESSION_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info({ version: version.join('.'), isLatest }, 'using WhatsApp Web version');

  const msgRetryCounterCache = new NodeCache({ stdTTL: 300, useClones: false });
  const userDevicesCache = new NodeCache({ stdTTL: 300, useClones: false });

  const sock = makeWASocket({
    version,
    logger: baileysLogger,
    auth: {
      creds: authState.creds,
      // Caching the signal key store cuts disk reads dramatically on busy chats.
      keys: makeCacheableSignalKeyStore(authState.keys, baileysLogger),
    },
    browser: Browsers.macOS('Safari'),
    markOnlineOnConnect: false, // keeps phone notifications working
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    generateHighQualityLinkPreview: true,
    msgRetryCounterCache,
    userDevicesCache,
    getMessage,
    cachedGroupMetadata: async (jid) => group.cachedGroupMetadata(sock)(jid),
  });

  /* pairing code — an alternative to scanning a QR */
  if (!sock.authState.creds.registered && config.PAIR_NUMBER) {
    // The socket needs a moment on the wire before WhatsApp will issue a code.
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(config.PAIR_NUMBER);
        logger.info({ code: code?.match(/.{1,4}/g)?.join('-') }, 'pairing code ready');
        console.log(`\n  Pairing code for +${config.PAIR_NUMBER}:  ${code?.match(/.{1,4}/g)?.join('-')}\n`);
        console.log('  WhatsApp → Settings → Linked devices → Link with phone number\n');
      } catch (err) {
        logger.error({ err: err.message }, 'could not request a pairing code');
      }
    }, 4000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !config.PAIR_NUMBER) {
      state.qr = qr;
      qrTerminal.generate(qr, { small: true });
      console.log('  Scan the QR above, or set PAIR_NUMBER in .env to use a pairing code.\n');
    }

    if (connection === 'open') {
      state.connected = true;
      state.qr = null;
      state.user = sock.user;
      reconnectAttempts = 0;
      logger.info({ user: sock.user?.id, name: sock.user?.name }, 'connected to WhatsApp');
    }

    if (connection === 'close') {
      state.connected = false;
      const status = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.output?.payload?.statusCode;

      // A logged-out session can never be revived by reconnecting. Deleting it
      // automatically (as the original did) turns one revoked device into an
      // endless reconnect loop, so we stop and let a human decide.
      if (status === DisconnectReason.loggedOut) {
        logger.error('session logged out — delete the session folder and pair again (npm run reset)');
        state.qr = null;
        return;
      }

      if (status === DisconnectReason.restartRequired) {
        logger.info('restart required — reconnecting immediately');
        return void connect();
      }

      reconnectAttempts++;
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 60_000);
      logger.warn({ status, attempt: reconnectAttempts, delay }, 'connection closed — reconnecting');
      setTimeout(connect, delay);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      handleMessage(sock, msg).catch((err) => logger.error({ err: err.stack }, 'unhandled message error'));
    }
  });

  registerEvents(sock);

  return sock;
}

export default connect;
