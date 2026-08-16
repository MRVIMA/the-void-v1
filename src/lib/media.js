import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import webpmux from 'node-webpmux';
import { fileTypeFromBuffer } from 'file-type';
import { log } from './logger.js';

const logger = log('media');

const TMP = path.join(os.tmpdir(), 'wa-bot-media');
fsSync.mkdirSync(TMP, { recursive: true });

/* ── temp files ──────────────────────────────────────────────────────────── */

const tmpFile = (ext = 'bin') => path.join(TMP, `${crypto.randomUUID()}.${ext}`);

/** Runs `fn` with a scratch file per extension and always cleans up after. */
async function withTmp(exts, fn) {
  const files = exts.map(tmpFile);
  try {
    return await fn(...files);
  } finally {
    await Promise.all(files.map((f) => fs.rm(f, { force: true }).catch(() => {})));
  }
}

/** Deletes anything in the scratch directory older than an hour. */
export async function sweepTmp(maxAgeMs = 3_600_000) {
  const cutoff = Date.now() - maxAgeMs;
  const entries = await fs.readdir(TMP).catch(() => []);
  let removed = 0;
  for (const name of entries) {
    const file = path.join(TMP, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.rm(file, { force: true }).catch(() => {});
      removed++;
    }
  }
  if (removed) logger.debug({ removed }, 'swept temp files');
  return removed;
}

/* ── ffmpeg ──────────────────────────────────────────────────────────────── */

/**
 * Spawns the bundled ffmpeg binary. We drive it directly rather than through
 * fluent-ffmpeg (unmaintained) — this is a few lines and has no dependency.
 */
export function ffmpeg(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      windowsHide: true,
    });

    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited with code ${code}`));
    });
  });
}

/** Converts a media buffer through ffmpeg with the given output args. */
async function convert(buffer, inExt, outExt, args) {
  return withTmp([inExt, outExt], async (input, output) => {
    await fs.writeFile(input, buffer);
    await ffmpeg(['-i', input, ...args, output]);
    return fs.readFile(output);
  });
}

/* ── audio ───────────────────────────────────────────────────────────────── */

/** Opus/ogg suitable for a WhatsApp voice note (`ptt: true`). */
export const toVoiceNote = (buffer) =>
  convert(buffer, 'tmp', 'ogg', ['-vn', '-c:a', 'libopus', '-b:a', '48k', '-ar', '48000', '-ac', '1']);

export const toMp3 = (buffer) => convert(buffer, 'tmp', 'mp3', ['-vn', '-c:a', 'libmp3lame', '-b:a', '128k']);

/** Applies an ffmpeg audio filter chain — powers .bass, .nightcore, .slow etc. */
export const audioFilter = (buffer, filter) =>
  convert(buffer, 'tmp', 'mp3', ['-vn', '-af', filter, '-c:a', 'libmp3lame', '-b:a', '128k']);

/* ── video ───────────────────────────────────────────────────────────────── */

export const toMp4 = (buffer) =>
  convert(buffer, 'tmp', 'mp4', ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-movflags', '+faststart']);

/** Strips the audio track — WhatsApp treats silent mp4 as a GIF. */
export const toGifVideo = (buffer) =>
  convert(buffer, 'mp4', 'mp4', ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-movflags', '+faststart']);

/** Reads duration/dimensions without a separate ffprobe dependency. */
export async function mediaInfo(buffer, ext = 'tmp') {
  return withTmp([ext], async (input) => {
    await fs.writeFile(input, buffer);
    const probePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
    if (!fsSync.existsSync(probePath)) return null;
    return new Promise((resolve) => {
      const proc = spawn(probePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input], {
        windowsHide: true,
      });
      let out = '';
      proc.stdout.on('data', (d) => (out += d));
      proc.on('close', () => {
        try {
          resolve(JSON.parse(out));
        } catch {
          resolve(null);
        }
      });
      proc.on('error', () => resolve(null));
    });
  });
}

/* ── images & stickers ───────────────────────────────────────────────────── */

/**
 * Still image -> 512x512 WebP sticker. `sharp` handles this natively, so no
 * temp files and no ffmpeg round-trip.
 */
export async function imageToSticker(buffer, { crop = false } = {}) {
  return sharp(buffer, { animated: false })
    .resize(512, 512, {
      fit: crop ? 'cover' : 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();
}

/** Video/GIF -> animated WebP sticker, capped so WhatsApp accepts it. */
export async function videoToSticker(buffer, { seconds = 8, fps = 15 } = {}) {
  const filter = `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000`;
  const webp = await convert(buffer, 'mp4', 'webp', [
    '-t', String(seconds),
    '-vf', filter,
    '-c:v', 'libwebp',
    '-lossless', '0',
    '-q:v', '55',
    '-loop', '0',
    '-an', '-vsync', '0',
  ]);
  if (webp.length > 900_000) {
    // Second pass at lower quality — WhatsApp rejects stickers around 1 MB.
    return convert(buffer, 'mp4', 'webp', [
      '-t', String(Math.min(seconds, 6)),
      '-vf', filter.replace(`fps=${fps}`, 'fps=10'),
      '-c:v', 'libwebp', '-lossless', '0', '-q:v', '35', '-loop', '0', '-an', '-vsync', '0',
    ]);
  }
  return webp;
}

/** Sticker (WebP) -> PNG, for `.toimage`. */
export const stickerToImage = (buffer) => sharp(buffer, { animated: false }).png().toBuffer();

/**
 * Writes the sticker pack name and author WhatsApp shows in sticker info.
 *
 * WhatsApp reads a raw JSON blob from the WebP container's EXIF chunk. sharp
 * cannot write that — its `withExif` takes structured IFD tags, and handing it
 * a Buffer throws — so the chunk is muxed into the container directly.
 *
 * Branding is cosmetic: if anything here fails, the caller still gets a
 * perfectly good unbranded sticker.
 */
export async function brandSticker(webp, { pack = '', author = '' } = {}) {
  if (!pack && !author) return webp;

  try {
    const json = Buffer.from(
      JSON.stringify({
        'sticker-pack-id': crypto.randomUUID(),
        'sticker-pack-name': pack,
        'sticker-pack-publisher': author,
        emojis: [],
      }),
      'utf-8',
    );

    // Minimal TIFF/EXIF header carrying one custom tag whose payload is the
    // JSON above. Byte 14 onward holds the payload length.
    const header = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);
    header.writeUInt32LE(json.length, 14);

    const image = new webpmux.Image();
    await image.load(webp);
    image.exif = Buffer.concat([header, json]);
    return await image.save(null);
  } catch (err) {
    logger.warn({ err: err.message }, 'sticker branding failed — sending unbranded');
    return webp;
  }
}

/* ── type detection ──────────────────────────────────────────────────────── */

/** `{ ext, mime }` sniffed from magic bytes, never from a filename. */
export async function detectType(buffer) {
  const type = await fileTypeFromBuffer(buffer).catch(() => null);
  return { ext: type?.ext ?? 'bin', mime: type?.mime ?? 'application/octet-stream' };
}

export default {
  ffmpeg, toVoiceNote, toMp3, audioFilter, toMp4, toGifVideo, mediaInfo,
  imageToSticker, videoToSticker, stickerToImage, brandSticker, detectType, sweepTmp,
};
