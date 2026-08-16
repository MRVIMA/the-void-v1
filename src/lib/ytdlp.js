import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import ffmpegPath from 'ffmpeg-static';
import config from '../config.js';
import { log } from './logger.js';

const logger = log('ytdlp');

const require = createRequire(import.meta.url);
/** Path to the yt-dlp binary npm placed in node_modules. */
const YTDLP = require('youtube-dl-exec').constants.YOUTUBE_DL_PATH;

/* ── concurrency ─────────────────────────────────────────────────────────── */

/**
 * yt-dlp plus ffmpeg is CPU- and bandwidth-hungry. Without a cap, five people
 * typing `.song` at once will spawn ten processes and take the host down, so
 * downloads queue instead of piling up.
 */
const waiting = [];
let active = 0;

async function acquire() {
  if (active >= config.DOWNLOAD_CONCURRENCY) {
    await new Promise((resolve) => waiting.push(resolve));
  }
  active++;
}

function release() {
  active--;
  waiting.shift()?.();
}

export const queueDepth = () => ({ active, waiting: waiting.length });

/* ── process runner ──────────────────────────────────────────────────────── */

const BASE_ARGS = [
  '--no-warnings',
  '--no-playlist', // a playlist URL must not turn into 200 downloads
  '--no-cache-dir',
  '--restrict-filenames',
  '--socket-timeout',
  '30',
  '--retries',
  '3',
  '--ffmpeg-location',
  ffmpegPath,
];

/** Turns yt-dlp's stderr into something worth showing a user. */
function friendlyError(stderr) {
  const line = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('ERROR:'))
    .pop();

  if (!line) return 'The download failed.';
  const message = line.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[^:]*:\s*/, '');

  if (/private|members-only/i.test(message)) return 'That video is private.';
  if (/unavailable|removed|deleted/i.test(message)) return 'That video is unavailable or has been removed.';
  if (/age|sign in to confirm/i.test(message)) return 'That video is age-restricted and cannot be fetched.';
  if (/geo|not available in your country/i.test(message)) return 'That video is blocked in this server’s region.';
  if (/unsupported url/i.test(message)) return 'That site is not supported.';
  if (/copyright/i.test(message)) return 'That video was taken down for copyright.';
  return message.slice(0, 200);
}

function run(args, { timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [...BASE_ARGS, ...args], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 16_000) stderr = stderr.slice(-8000);
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`The download timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start yt-dlp: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(friendlyError(stderr)));
    });
  });
}

/* ── public API ──────────────────────────────────────────────────────────── */

/** Metadata only — no media is transferred. */
export async function probe(url) {
  const raw = await run(['--dump-single-json', url], { timeoutMs: 60_000 });
  const info = JSON.parse(raw);
  return {
    id: info.id,
    title: info.title ?? 'Unknown title',
    uploader: info.uploader ?? info.channel ?? '',
    duration: Number(info.duration) || 0,
    thumbnail: info.thumbnail ?? null,
    webpage: info.webpage_url ?? url,
    extractor: info.extractor_key ?? '',
    views: Number(info.view_count) || 0,
    filesize: Number(info.filesize ?? info.filesize_approx) || 0,
    isLive: Boolean(info.is_live),
  };
}

/**
 * Downloads a URL and returns the bytes.
 *
 * Guards run before any media moves: live streams are refused, over-long media
 * is refused, and `--max-filesize` makes yt-dlp abort mid-transfer rather than
 * filling the disk with something we would only reject afterwards.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {boolean} [options.audio]   extract audio as mp3 instead of video
 * @param {number}  [options.height]  cap video height, default 720
 * @param {object}  [options.info]    pre-fetched probe() result, to skip a round-trip
 * @param {number}  [options.audioBitrate] MP3 bitrate in kbps
 */
export async function download(url, { audio = false, height = 720, audioBitrate = 192, info: known = null } = {}) {
  const info = known ?? (await probe(url));

  if (info.isLive) throw new Error('That is a live stream — there is nothing to download.');

  const maxSeconds = config.MAX_DURATION_MIN * 60;
  if (info.duration && info.duration > maxSeconds) {
    const mins = Math.round(info.duration / 60);
    throw new Error(`That is ${mins} minutes long — the limit is ${config.MAX_DURATION_MIN} minutes.`);
  }

  const dir = path.join(os.tmpdir(), 'wa-bot-dl', crypto.randomUUID());
  await fs.mkdir(dir, { recursive: true });

  await acquire();
  try {
    const format = audio
      ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', `${audioBitrate}K`]
      : [
          '-f',
          `bestvideo[height<=?${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=?${height}][ext=mp4]/best[height<=?${height}]/best`,
          '--merge-output-format',
          'mp4',
        ];

    await run([
      ...format,
      '--max-filesize',
      `${config.MAX_UPLOAD_MB}M`,
      '-o',
      path.join(dir, 'media.%(ext)s'),
      url,
    ]);

    const files = await fs.readdir(dir);
    if (!files.length) {
      throw new Error(`Nothing was downloaded — the file is probably larger than ${config.MAX_UPLOAD_MB} MB.`);
    }

    const file = path.join(dir, files[0]);
    const stat = await fs.stat(file);
    if (stat.size > config.MAX_UPLOAD_MB * 1024 * 1024) {
      throw new Error(`That file is too large to send (limit ${config.MAX_UPLOAD_MB} MB).`);
    }

    const buffer = await fs.readFile(file);
    logger.info({ url: info.webpage, bytes: buffer.length, audio }, 'download complete');

    return { buffer, info, ext: path.extname(file).slice(1) || (audio ? 'mp3' : 'mp4') };
  } finally {
    release();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Self-updates the yt-dlp binary.
 *
 * Sites change their players constantly and a yt-dlp more than a few weeks old
 * is the single most common cause of "download failed". This lets the owner fix
 * that from a chat instead of redeploying.
 */
export async function updateBinary() {
  const out = await run(['-U'], { timeoutMs: 120_000 });
  const line = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  return line || 'yt-dlp is up to date.';
}

/** Currently installed yt-dlp version string. */
export async function version() {
  return (await run(['--version'], { timeoutMs: 30_000 })).trim();
}

export default { probe, download, queueDepth, updateBinary, version };
