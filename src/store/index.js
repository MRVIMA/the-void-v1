import config from '../config.js';
import { log } from '../lib/logger.js';
import { createMongoStore } from './mongo.js';

const logger = log('store');

/** Namespaces used across the bot. Keep them here so nothing invents strings. */
export const NS = {
  SETTINGS: 'settings', // global bot settings, editable with .set
  GROUP: 'group', // per-group settings keyed by group jid
  USER: 'user', // per-user data keyed by phone number
  BAN: 'ban', // banned users / groups
  AUTOREPLY: 'autoreply', // keyword -> reply
  NOTE: 'note', // saved notes
  STATE: 'state', // internal bookkeeping (last-seen urls, counters)
  AFK: 'afk', // afk status per user
  ANTIDELETE: 'antidelete', // cached message bodies for revoke recovery
};

/**
 * Settings the owner can change at runtime with `.set <key> <value>`.
 * Values here are the defaults applied on first boot; anything stored
 * in the database wins.
 */
export const DEFAULT_SETTINGS = {
  prefix: config.PREFIX,
  mode: config.MODE, // private | public | group | inbox
  autoRead: false,
  autoReadStatus: false,
  autoReactStatus: false,
  statusReactEmoji: '💚',
  alwaysOnline: false,
  autoTyping: false,
  autoRecording: false,
  antiDelete: false,
  antiDeleteTarget: 'owner', // owner | chat
  antiCall: false,
  antiCallAction: 'reject', // reject | block
  welcome: false,
  goodbye: false,
  aiChat: false, // reply to plain messages with AI in DMs
  reactToCommands: true,
  errorDetails: false, // show stack traces to the owner
  adultCommands: config.ENABLE_ADULT,
};

/**
 * Turns a MongoDB connection failure into an instruction.
 *
 * These four causes account for essentially every Atlas connection problem,
 * and the driver's own message names none of them plainly.
 */
function diagnose(err, uri = '') {
  const message = String(err?.message ?? err);

  if (/querySrv|ESERVFAIL|ECONNREFUSED.*_mongodb/.test(message) || (/ECONNREFUSED/.test(message) && uri.startsWith('mongodb+srv'))) {
    return 'This network blocks the SRV DNS lookup that mongodb+srv:// needs. Use the direct mongodb:// form listing each shard host (see the commented line in .env.example).';
  }
  if (/Authentication failed|bad auth/i.test(message)) {
    return 'The username or password in MONGO_URI is wrong. Check Atlas > Database Access, and URL-encode any special characters in the password.';
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) {
    return 'The cluster hostname does not resolve. Check MONGO_URI for a typo, or whether the cluster was deleted.';
  }
  // Atlas reports a blocked IP as a plain server-selection failure with no
  // mention of allowlists, so match on the error type rather than its text.
  if (
    err?.name === 'MongoServerSelectionError' ||
    /not whitelisted|ETIMEDOUT|ECONNREFUSED|ServerSelection|timed out/i.test(message)
  ) {
    return "Could not reach the cluster. Usually this host's IP is not allowed — add it in Atlas > Network Access (0.0.0.0/0 for platforms without a fixed outbound IP). Otherwise check the host and port.";
  }
  return 'Check MONGO_URI, then Atlas Network Access and Database Access.';
}

let store = null;

/** Connects the configured backend. Falls back to SQLite if Mongo is down. */
export async function initStore() {
  if (store) return store;

  if (config.MONGO_URI) {
    try {
      store = await createMongoStore(config.MONGO_URI);
    } catch (err) {
      // Falling back to SQLite keeps the bot alive, but on a host with no
      // persistent disk it means settings silently reset on every restart.
      // Name the actual cause so this is fixable from the log alone.
      logger.error({ err: err.message }, 'MongoDB unreachable — falling back to local SQLite');
      logger.error(`  → ${diagnose(err, config.MONGO_URI)}`);
    }
  }
  if (!store) {
    // Imported lazily so a Mongo-only deployment on an older Node runtime
    // never touches the built-in sqlite module.
    const { createSqliteStore } = await import('./sqlite.js');
    store = createSqliteStore(config.SQLITE_PATH);
  }

  // Seed any setting that has never been written.
  const existing = Object.fromEntries((await store.all(NS.SETTINGS)).map((r) => [r.key, r.value]));
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(key in existing)) await store.set(NS.SETTINGS, key, value);
  }

  return store;
}

export function getStore() {
  if (!store) throw new Error('Store used before initStore() — call it during boot.');
  return store;
}

/* ── settings helpers ────────────────────────────────────────────────────── */

export const settings = {
  async get(key) {
    const v = await getStore().get(NS.SETTINGS, key);
    return v === null ? DEFAULT_SETTINGS[key] : v;
  },
  async set(key, value) {
    return getStore().set(NS.SETTINGS, key, value);
  },
  async all() {
    const rows = await getStore().all(NS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  },
  /** True when a boolean-ish setting is enabled. */
  async on(key) {
    const v = await this.get(key);
    return v === true || v === 'true' || v === 1;
  },
};

/* ── per-group settings ──────────────────────────────────────────────────── */

export const DEFAULT_GROUP = {
  antilink: false,
  antilinkAction: 'delete', // delete | warn | kick
  antibad: false,
  antibadAction: 'delete',
  antibot: false,
  welcome: false,
  welcomeText: '',
  goodbye: false,
  goodbyeText: '',
  mute: false,
  nsfw: false,
  warnLimit: 3,
};

export const groups = {
  async get(jid) {
    const saved = (await getStore().get(NS.GROUP, jid)) || {};
    return { ...DEFAULT_GROUP, ...saved };
  },
  async set(jid, patch) {
    const next = { ...(await this.get(jid)), ...patch };
    await getStore().set(NS.GROUP, jid, next);
    return next;
  },
  async reset(jid) {
    return getStore().delete(NS.GROUP, jid);
  },
};

/* ── bans ────────────────────────────────────────────────────────────────── */

export const bans = {
  async isBanned(id) {
    return (await getStore().get(NS.BAN, id)) !== null;
  },
  async ban(id, reason = '') {
    return getStore().set(NS.BAN, id, { reason, at: Date.now() });
  },
  async unban(id) {
    return getStore().delete(NS.BAN, id);
  },
  async list() {
    return getStore().all(NS.BAN);
  },
};

export default { initStore, getStore, settings, groups, bans, NS };
