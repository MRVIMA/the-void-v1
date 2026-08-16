import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import config, { ROOT } from '../config.js';
import { getBuffer, isUrl } from './http.js';
import { log } from './logger.js';

const logger = log('banner');

/**
 * Per-menu banner images.
 *
 * Each menu asks for its own artwork by name — `banner('alive')` looks for
 * assets/alive.png. Anything missing falls back to assets/banner.png, and if
 * that is absent too the menu simply sends as text. A missing image is never
 * an error: the bot must work before the artwork exists.
 *
 * Resolved bytes are cached per name. `.menu` may be called hundreds of times
 * and re-reading the same file each call is pure waste.
 */

const ASSETS = path.resolve(ROOT, 'assets');

/** menu name -> Buffer | null (null = looked, not found) */
const cache = new Map();

/**
 * Absolute path -> optimised Buffer.
 *
 * Separate from the name cache because several menus resolve to the same file:
 * every menu without its own art falls back to banner.png. Keyed only by name,
 * that file would be read and re-encoded once per menu — eight needless passes
 * over a multi-megabyte image.
 */
const fileCache = new Map();

/** Extensions tried, in order, for a given banner name. */
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

/** Above this, the source is downscaled before it is ever sent. */
const MAX_SEND_BYTES = 350_000;
const MAX_WIDTH = 1280;

/**
 * Shrinks oversized artwork for sending.
 *
 * WhatsApp re-uploads the image on every send, so a 2 MB source becomes 2 MB
 * of upload on every single `.menu`. Downscaling once at load turns that into
 * a fraction of the traffic with no visible difference on a phone. The file on
 * disk is left untouched.
 */
async function optimise(buf, label) {
  if (buf.length <= MAX_SEND_BYTES) return buf;
  try {
    const out = await sharp(buf)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    // Only take it if it actually helped.
    if (out.length < buf.length) {
      logger.info(
        { banner: label, from: buf.length, to: out.length },
        'banner downscaled for sending',
      );
      return out;
    }
  } catch (err) {
    logger.warn({ banner: label, err: err.message }, 'could not downscale banner');
  }
  return buf;
}

async function readFirst(name) {
  for (const ext of EXTENSIONS) {
    const file = path.join(ASSETS, `${name}.${ext}`);

    if (fileCache.has(file)) return fileCache.get(file);

    try {
      const buf = await fs.readFile(file);
      logger.debug({ file, bytes: buf.length }, 'banner loaded');
      const ready = await optimise(buf, name);
      fileCache.set(file, ready);
      return ready;
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

async function readConfiguredImage(file) {
  const resolved = path.resolve(ROOT, file);
  if (fileCache.has(resolved)) return fileCache.get(resolved);

  try {
    const buf = await fs.readFile(resolved);
    const ready = await optimise(buf, 'menu');
    fileCache.set(resolved, ready);
    return ready;
  } catch (err) {
    logger.warn({ file: resolved, err: err.message }, 'configured menu image could not be loaded');
    return null;
  }
}

/**
 * @param {string} name menu name, e.g. 'menu' | 'alive' | 'group'
 * @returns {Promise<Buffer|null>}
 */
export async function banner(name = 'menu') {
  if (cache.has(name)) return cache.get(name);

  let buf = await readFirst(name);

  // MENU_IMAGE may be a URL or a project-relative/absolute local path.
  if (!buf && name === 'menu') {
    if (isUrl(config.MENU_IMAGE)) {
      buf = await getBuffer(config.MENU_IMAGE).catch((err) => {
        logger.warn({ err: err.message }, 'menu banner url failed');
        return null;
      });
    } else if (config.MENU_IMAGE) {
      buf = await readConfiguredImage(config.MENU_IMAGE);
    }
  }

  // Fall back to the generic banner for any menu without its own art.
  if (!buf && name !== 'banner') buf = await readFirst('banner');

  if (!buf) logger.debug({ name }, 'no banner — menu will send as text');

  cache.set(name, buf);
  return buf;
}

/** Saves artwork for a menu and refreshes the cache. */
export async function saveBanner(name, buffer) {
  await fs.mkdir(ASSETS, { recursive: true });
  const file = path.join(ASSETS, `${name}.png`);
  await fs.writeFile(file, buffer);

  // Drop everything: a new default changes what the fallbacks resolve to.
  cache.clear();
  fileCache.clear();
  logger.info({ file, bytes: buffer.length }, 'banner saved');
  return file;
}

/** Which banners exist on disk right now. */
export async function listBanners() {
  const found = [];
  for (const file of await fs.readdir(ASSETS).catch(() => [])) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (EXTENSIONS.includes(ext)) found.push(path.basename(file, path.extname(file)));
  }
  return found.sort();
}

export const resetBanner = () => {
  cache.clear();
  fileCache.clear();
};

export default banner;
