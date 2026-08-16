import * as cheerio from 'cheerio';
import { command } from '../core/registry.js';
import config from '../config.js';
import { download, probe, queueDepth, updateBinary, version } from '../lib/ytdlp.js';
import { getBuffer, http, isUrl } from '../lib/http.js';
import { bytes, compact, truncate } from '../lib/format.js';
import { fetchAndSend, infoHeader, resolveTarget, status } from '../lib/deliver.js';

// The probe/guard/download/send flow is shared with the NSFW section.
const header = infoHeader;

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
  async ({ m, text }) => {
    if (!text) return m.reply('What should I fetch? e.g. `.song bohemian rhapsody`');

    const bar = await status(m, '🔎 Searching…');
    const url = await resolveTarget(text);

    const info = await probe(url);
    const { active, waiting } = queueDepth();
    await bar.update(`⏬ Downloading *${truncate(info.title, 50)}*…${waiting ? ` (queued, ${active} running)` : ''}`);

    const { buffer } = await download(url, { audio: true, info });

    await bar.update(`📤 Sending — ${bytes(buffer.length)}…`);
    await m.reply({
      audio: buffer,
      mimetype: 'audio/mpeg',
      fileName: `${info.title.replace(/[\\/:*?"<>|]/g, '')}.mp3`.slice(0, 120),
      contextInfo: info.thumbnail
        ? {
            externalAdReply: {
              title: truncate(info.title, 60),
              body: info.uploader || 'YouTube',
              thumbnailUrl: info.thumbnail,
              mediaType: 2,
              sourceUrl: info.webpage,
              renderLargerThumbnail: false,
            },
          }
        : undefined,
    });

    return bar.update(`✅ ${header(info)}`);
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
  async ({ m, text, args }) => {
    if (!text) return m.reply('What should I fetch? e.g. `.video interstellar trailer`');

    // Optional trailing quality flag: `.video something 480`
    let height = 720;
    let query = text;
    const last = args.at(-1);
    if (/^(144|240|360|480|720|1080)$/.test(last ?? '')) {
      height = Number(last);
      query = args.slice(0, -1).join(' ');
    }

    const bar = await status(m, '🔎 Searching…');
    const url = await resolveTarget(query);

    const info = await probe(url);
    await bar.update(`⏬ Downloading *${truncate(info.title, 50)}* at ${height}p…`);

    const { buffer } = await download(url, { height, info });

    await bar.update(`📤 Sending — ${bytes(buffer.length)}…`);
    await m.reply({
      video: buffer,
      mimetype: 'video/mp4',
      fileName: `${info.title.replace(/[\\/:*?"<>|]/g, '')}.mp4`.slice(0, 120),
      caption: header(info),
    });

    return bar.update('✅ Sent.');
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
  async ({ m, text }) => fetchAndSend(m, text.trim()),
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
    async ({ m, text }) => {
      const url = text.trim();
      if (!url) return m.reply(`Give me a ${label} link, e.g. \`.${name} ${example}\``);
      return fetchAndSend(m, url);
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
  async ({ m, text }) => fetchAndSend(m, text.trim(), { audio: true }),
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
  async ({ m, text }) => {
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

    await bar.update(`⏬ Downloading *${truncate(name, 50)}* ${sizeText}…`);
    const buffer = await getBuffer(direct);

    if (buffer.length > config.MAX_UPLOAD_MB * 1024 * 1024) {
      return bar.update(`❌ That file is ${bytes(buffer.length)} — over the ${config.MAX_UPLOAD_MB} MB send limit.`);
    }

    await bar.update(`📤 Sending — ${bytes(buffer.length)}…`);
    await m.reply({ document: buffer, fileName: name, mimetype: 'application/octet-stream' });

    return bar.update(`✅ ${name} — ${bytes(buffer.length)}`);
  },
);
