import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory holding the source tree (`<project>/src`). */
export const SRC = path.dirname(fileURLToPath(import.meta.url));
/** Project root — the folder containing package.json. */
export const ROOT = path.resolve(SRC, '..');

/* ── coercion helpers ────────────────────────────────────────────────────── */

const str = (key, fallback = '') => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : String(v).trim();
};

const bool = (key, fallback = false) => {
  const v = str(key, '');
  if (!v) return fallback;
  return ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
};

const int = (key, fallback) => {
  const n = Number.parseInt(str(key, ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Comma/space separated list -> array of digits-only phone numbers. */
const numbers = (key) =>
  str(key, '')
    .split(/[,\s]+/)
    .map((v) => v.replace(/\D/g, ''))
    .filter(Boolean);

/** Comma/space separated list, kept verbatim (JIDs, urls, words). */
const list = (key) =>
  str(key, '')
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);

/* ── config ──────────────────────────────────────────────────────────────── */

export const config = Object.freeze({
  /* identity */
  BOT_NAME: str('BOT_NAME', 'WhatsApp Bot'),
  OWNER_NAME: str('OWNER_NAME', 'Owner'),
  OWNER_NUMBERS: numbers('OWNER_NUMBER'),
  SUDO_NUMBERS: numbers('SUDO_NUMBERS'),

  /* session */
  SESSION_ID: str('SESSION_ID'),
  SESSION_DIR: path.resolve(ROOT, str('SESSION_DIR', 'session')),
  /** Phone number for pairing-code login (digits only, with country code). */
  PAIR_NUMBER: str('PAIR_NUMBER').replace(/\D/g, ''),

  /* behaviour */
  PREFIX: str('PREFIX', '.'),
  /** private = owner+sudo only · public = anyone · group / inbox = scoped */
  MODE: str('MODE', 'private').toLowerCase(),
  TIMEZONE: str('TIMEZONE', 'Asia/Colombo'),
  LANG: str('LANG', 'en').toLowerCase(),

  /* storage */
  MONGO_URI: str('MONGO_URI'),
  SQLITE_PATH: path.resolve(ROOT, str('SQLITE_PATH', 'data/bot.db')),

  /* limits */
  COMMAND_COOLDOWN_MS: int('COMMAND_COOLDOWN_MS', 2000),
  RATE_LIMIT_PER_MIN: int('RATE_LIMIT_PER_MIN', 20),
  MAX_UPLOAD_MB: int('MAX_UPLOAD_MB', 90),
  REQUEST_TIMEOUT_MS: int('REQUEST_TIMEOUT_MS', 30_000),
  /** Refuse media longer than this, before any bytes are transferred. */
  MAX_DURATION_MIN: int('MAX_DURATION_MIN', 20),
  /** Simultaneous yt-dlp/ffmpeg jobs. Raise only on a machine with headroom. */
  DOWNLOAD_CONCURRENCY: Math.max(1, int('DOWNLOAD_CONCURRENCY', 2)),

  /* integrations (all optional — features degrade, nothing crashes) */
  GEMINI_API_KEY: str('GEMINI_API_KEY'),
  GEMINI_MODEL: str('GEMINI_MODEL', 'gemini-2.5-flash'),
  OPENWEATHER_API_KEY: str('OPENWEATHER_API_KEY'),
  TMDB_API_KEY: str('TMDB_API_KEY'),
  OMDB_API_KEY: str('OMDB_API_KEY'),
  OPENSUBTITLES_API_KEY: str('OPENSUBTITLES_API_KEY'),
  /** Default subtitle languages, e.g. "en,si". */
  SUBTITLE_LANGS: str('SUBTITLE_LANGS', 'en'),
  CINESUBZ_API_KEY: str('CINESUBZ_API_KEY'),
  CINESUBZ_API_URL: str('CINESUBZ_API_URL'),

  /* feature flags */
  ENABLE_ADULT: bool('ENABLE_ADULT', false),
  ENABLE_MOVIE: bool('ENABLE_MOVIE', true),
  ENABLE_AI: bool('ENABLE_AI', true),

  /* menu */
  /** Banner shown on the main menu: a URL, or a path relative to the project. */
  MENU_IMAGE: str('MENU_IMAGE', 'assets/banner.png'),
  MENU_TAGLINE: str('MENU_TAGLINE', 'EMBRACE THE NOTHING. BECOME EVERYTHING.'),

  /* web */
  PORT: int('PORT', 8000),
  PUBLIC_URL: str('PUBLIC_URL'),

  /* misc */
  BLOCKED_NUMBERS: numbers('BLOCKED_NUMBERS'),
  BLOCKED_GROUPS: list('BLOCKED_GROUPS'),
});

/* ── validation ──────────────────────────────────────────────────────────── */

/**
 * Checked once at boot. Returns a list of human-readable problems; the caller
 * decides whether they are fatal. We never throw on optional integrations —
 * a missing API key should disable one command, not the whole bot.
 */
export function validateConfig() {
  const fatal = [];
  const warn = [];

  if (!config.OWNER_NUMBERS.length) {
    fatal.push('OWNER_NUMBER is not set — nobody would be able to control the bot.');
  }
  for (const n of config.OWNER_NUMBERS) {
    if (n.length < 8 || n.length > 15) {
      fatal.push(`OWNER_NUMBER "${n}" is not a valid international number (country code, no +).`);
    }
  }
  if (!['private', 'public', 'group', 'inbox'].includes(config.MODE)) {
    fatal.push(`MODE "${config.MODE}" is invalid — use private, public, group or inbox.`);
  }
  if (config.PREFIX.length > 3) {
    warn.push(`PREFIX "${config.PREFIX}" is unusually long.`);
  }
  if (config.PAIR_NUMBER && (config.PAIR_NUMBER.length < 8 || config.PAIR_NUMBER.length > 15)) {
    fatal.push('PAIR_NUMBER must be a full international number, digits only.');
  }

  if (!config.GEMINI_API_KEY && config.ENABLE_AI) warn.push('GEMINI_API_KEY missing — AI commands disabled.');
  if (!config.OPENWEATHER_API_KEY) warn.push('OPENWEATHER_API_KEY missing — .weather disabled.');
  if (!config.TMDB_API_KEY) warn.push('TMDB_API_KEY missing — .tmdb disabled.');
  if (!config.MONGO_URI) warn.push('MONGO_URI missing — using local SQLite store.');

  try {
    new Intl.DateTimeFormat('en', { timeZone: config.TIMEZONE });
  } catch {
    fatal.push(`TIMEZONE "${config.TIMEZONE}" is not a valid IANA zone (e.g. Asia/Colombo).`);
  }

  return { fatal, warn };
}

export default config;
