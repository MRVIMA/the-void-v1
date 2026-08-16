import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { command } from '../core/registry.js';
import config from '../config.js';
import { probe, updateBinary, version } from '../lib/ytdlp.js';
import { getBuffer, getJson, http, isUrl } from '../lib/http.js';
import { bytes, compact, truncate } from '../lib/format.js';
import { resolveTarget, status } from '../lib/deliver.js';
import { beginDownloadFlow } from '../lib/download-flow.js';
import { selectMenu } from '../lib/interactive.js';

const mediafireRequests = new Map();

function getMediafireRequest(token, m) {
  const request = mediafireRequests.get(token);
  if (!request || request.expiresAt < Date.now()) {
    mediafireRequests.delete(token);
    throw new Error('That MediaFire menu expired. Start again.');
  }
  if (request.chat !== m.chat || request.sender !== m.sender) throw new Error('That menu belongs to another user.');
  return request;
}

/**
 * Resolve and probe before opening the shared verification/quality menu.
 * No media bytes move until the user completes the menu.
 */
async function sendSearchedAudio(sock, m, prefix, query, origin = {}) {
  const bar = await status(m, '🔎 Searching…');
  const url = await resolveTarget(query);
  const info = await probe(url);
  await bar.update('✅ Link verified. Choose quality and delivery below.');
  return beginDownloadFlow(sock, m, { url, info, prefix, mode: 'audio', origin });
}

async function previewLink(sock, m, prefix, url, options = {}) {
  if (!isUrl(url)) return m.reply('Give me a link, e.g. `.dl https://…`');
  const bar = await status(m, '🔎 Reading the link…');
  const info = await probe(url);
  await bar.update('✅ Link verified. Choose below.');
  return beginDownloadFlow(sock, m, { url, info, prefix, ...options });
}

/* ── YouTube audio ───────────────────────────────────────────────────────── */

command(
  {
    name: 'song',
    alias: ['play', 'ytmp3', 'mp3'],
    category: 'download',
    desc: 'Download audio from YouTube by name or link',
    usage: '.song never gonna give you up',
    react: '🎵',
    cooldown: 15_000,
  },
  async ({ sock, m, text, prefix }) => {
    if (!text) return m.reply('What should I fetch? e.g. `.song bohemian rhapsody`');
    return sendSearchedAudio(sock, m, prefix, text);
  },
);

/* ── Spotify track audio ────────────────────────────────────────────────── */

command(
  {
    name: 'spotify',
    alias: ['spdl', 'spotifydl'],
    category: 'download',
    desc: 'Download audio matching a Spotify track link',
    usage: '.spotify https://open.spotify.com/track/…',
    react: '🟢',
    cooldown: 15_000,
  },
  async ({ sock, m, text, prefix }) => {
    const input = text.trim();
    if (!isUrl(input)) return m.reply('Give me a Spotify track link, e.g. `.spotify https://open.spotify.com/track/…`');

    let parsed;
    try {
      parsed = new URL(input);
    } catch {
      return m.reply('That is not a valid Spotify link.');
    }

    if (!/(^|\.)spotify\.com$/i.test(parsed.hostname)) {
      return m.reply('Only `open.spotify.com/track/…` links are accepted.');
    }

    const trackId = parsed.pathname.match(/(?:^|\/)track\/([A-Za-z0-9]+)/)?.[1];
    if (!trackId) {
      return m.reply('That is not a Spotify track link. Albums and playlists are not downloaded in bulk.');
    }

    const spotifyUrl = `https://open.spotify.com/track/${trackId}`;
    const meta = await getJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`);
    if (!meta?.title) throw new Error('Spotify could not read that track. It may be private or unavailable.');

    // Spotify streams are DRM-protected and are not exposed as downloadable
    // files. Use its public metadata to locate the matching available audio.
    return sendSearchedAudio(sock, m, prefix, `${meta.title} official audio`, {
      title: meta.title,
      thumbnail: meta.thumbnail_url,
      url: spotifyUrl,
      label: 'Spotify match',
    });
  },
);

/* ── YouTube video ───────────────────────────────────────────────────────── */

command(
  {
    name: 'video',
    alias: ['ytmp4', 'mp4'],
    category: 'download',
    desc: 'Download video from YouTube by name or link',
    usage: '.video lofi hip hop mix',
    react: '🎬',
    cooldown: 20_000,
  },
  async ({ sock, m, text, prefix }) => {
    if (!text) return m.reply('What should I fetch? e.g. `.video interstellar trailer`');
    const bar = await status(m, '🔎 Searching…');
    const url = await resolveTarget(text);
    const info = await probe(url);
    await bar.update('✅ Link verified. Choose video quality below.');
    return beginDownloadFlow(sock, m, { url, info, prefix, mode: 'video' });
  },
);

/* ── generic + per-site wrappers ─────────────────────────────────────────── */

/**
 * yt-dlp handles TikTok, Facebook, Instagram, X, Reddit and the rest through
 * the same extractor framework, so the site-specific commands below are thin
 * labels over one implementation rather than separate scrapers.
 */
command(
  {
    name: 'dl',
    alias: ['download', 'get'],
    category: 'download',
    desc: 'Download from any supported site',
    usage: '.dl https://www.tiktok.com/@user/video/123',
    react: '⏬',
    cooldown: 15_000,
  },
  async ({ sock, m, text, prefix }) => previewLink(sock, m, prefix, text.trim()),
);

const site = (name, alias, label, example) =>
  command(
    {
      name,
      alias,
      category: 'download',
      // Not "a ${label}" — that yields "a Instagram" for vowel-initial names.
      desc: `Download a video from ${label}`,
      usage: `.${name} ${example}`,
      react: '⏬',
      cooldown: 15_000,
    },
    async ({ sock, m, text, prefix }) => {
      const url = text.trim();
      if (!url) return m.reply(`Give me a ${label} link, e.g. \`.${name} ${example}\``);
      return previewLink(sock, m, prefix, url);
    },
  );

site('tiktok', ['tt'], 'TikTok', 'https://www.tiktok.com/@user/video/123');
site('fb', ['facebook'], 'Facebook', 'https://www.facebook.com/watch?v=123');
site('insta', ['ig', 'instagram'], 'Instagram', 'https://www.instagram.com/reel/abc');
site('twitter', ['x'], 'X / Twitter', 'https://x.com/user/status/123');

command(
  {
    name: 'dlaudio',
    alias: ['dlmp3'],
    category: 'download',
    desc: 'Download only the audio track from any supported link',
    usage: '.dlaudio https://…',
    react: '🎧',
    cooldown: 15_000,
  },
  async ({ sock, m, text, prefix }) => previewLink(sock, m, prefix, text.trim(), { mode: 'audio' }),
);

/* ── maintenance ─────────────────────────────────────────────────────────── */

command(
  {
    name: 'dlupdate',
    alias: ['ytdlp'],
    category: 'download',
    desc: 'Update the yt-dlp engine, or show its version',
    usage: '.dlupdate',
    ownerOnly: true,
    react: '🔧',
    cooldown: 60_000,
  },
  async ({ m, args }) => {
    if (args[0] === 'version') return m.reply(`🔧 yt-dlp ${await version()}`);

    const bar = await status(m, '🔧 Checking for a newer yt-dlp…');
    const result = await updateBinary();
    return bar.update(`🔧 ${result}\n\nNow running yt-dlp ${await version()}`);
  },
);

/* ── MediaFire ───────────────────────────────────────────────────────────── */

command(
  {
    name: 'mediafire',
    alias: ['mf'],
    category: 'download',
    desc: 'Download a file from a MediaFire link',
    usage: '.mediafire https://www.mediafire.com/file/…',
    react: '📁',
    cooldown: 15_000,
  },
  async ({ sock, m, text, prefix }) => {
    const url = text.trim();
    if (!isUrl(url) || !/mediafire\.com/i.test(url)) return m.reply('Give me a MediaFire link.');

    const bar = await status(m, '🔎 Reading the page…');

    // MediaFire is a plain download page, not a media extractor target, so the
    // direct link is read out of the markup.
    const page = await http.get(url);
    const $ = cheerio.load(page.data);

    const direct = $('#downloadButton').attr('href') || $('a.input.popsok').attr('href');
    const name = $('.dl-btn-label').attr('title') || $('.filename').first().text().trim() || 'file';
    const sizeText = $('#downloadButton').text().match(/\(([^)]+)\)/)?.[1] ?? '';

    if (!direct || !isUrl(direct)) {
      return bar.update('❌ Could not find a download link — MediaFire may have changed its page or the file is gone.');
    }

    const token = crypto.randomBytes(4).toString('hex');
    mediafireRequests.set(token, {
      chat: m.chat,
      sender: m.sender,
      direct,
      name,
      sizeText,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    await bar.update('✅ Link verified. Confirm below.');
    return selectMenu(sock, m, {
      title: 'MediaFire Information',
      body: `📄 *${truncate(name, 80)}*\n${sizeText ? `📦 ${sizeText}\n` : ''}🔗 MediaFire\n\nVerify the details before downloading.`,
      button: 'Choose action',
      footer: config.MENU_FOOTER,
      rows: [
        {
          title: 'Download Document',
          description: 'Download and send this file',
          id: `${prefix}mfget ${token}`,
        },
        {
          title: 'Cancel',
          description: 'Do not download this file',
          id: `${prefix}mfcancel ${token}`,
        },
      ],
    });
  },
);

command(
  { name: 'mfget', category: 'download', desc: 'Internal MediaFire confirmation', hidden: true },
  async ({ m, args }) => {
    const request = getMediafireRequest(args[0], m);
    mediafireRequests.delete(args[0]);
    const bar = await status(m, `⏬ Downloading *${truncate(request.name, 50)}* ${request.sizeText}…`);
    const buffer = await getBuffer(request.direct);
    if (buffer.length > config.MAX_UPLOAD_MB * 1024 * 1024) {
      return bar.update(`❌ That file is ${bytes(buffer.length)} — over the ${config.MAX_UPLOAD_MB} MB send limit.`);
    }
    await bar.update(`📤 Sending — ${bytes(buffer.length)}…`);
    await m.reply({ document: buffer, fileName: request.name, mimetype: 'application/octet-stream' });
    return bar.update(`✅ ${request.name} — ${bytes(buffer.length)}`);
  },
);

command(
  { name: 'mfcancel', category: 'download', desc: 'Cancel a pending MediaFire download', hidden: true },
  async ({ m, args }) => {
    getMediafireRequest(args[0], m);
    mediafireRequests.delete(args[0]);
    return m.reply('❌ Download cancelled.');
  },
);
