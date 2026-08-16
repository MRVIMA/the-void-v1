import ytSearch from 'yt-search';
import { download, probe } from './ytdlp.js';
import { isUrl } from './http.js';
import { bytes, compact, duration, truncate } from './format.js';

/**
 * Shared "fetch a link and send it back" flow.
 *
 * Both the download and NSFW sections do exactly the same thing — probe, guard,
 * download, send — so the logic lives here once. The only difference between
 * them is which menu they appear in and what gates the handler enforces.
 */

/** Resolves user input to a URL, searching YouTube for a bare query. */
export async function resolveTarget(input) {
  if (isUrl(input)) return input;

  const { videos } = await ytSearch(input);
  if (!videos?.length) throw new Error(`No results for *${input}*.`);
  return videos[0].url;
}

/** A single status message the command edits as it progresses. */
export async function status(m, text) {
  const sent = await m.reply(text);
  return {
    key: sent.key,
    update: (next) => m.send({ text: next, edit: sent.key }).catch(() => {}),
  };
}

export const infoHeader = (info) =>
  `*${info.title}*\n` +
  `${info.uploader ? `👤 ${info.uploader}\n` : ''}` +
  `${info.duration ? `⏱ ${duration(info.duration)}` : ''}` +
  `${info.views ? ` · 👁 ${compact(info.views)}` : ''}`;

/**
 * Downloads a URL and sends it back as video or audio.
 *
 * @param {object}  m                   serialized message
 * @param {string}  url
 * @param {object}  [options]
 * @param {boolean} [options.audio]     audio only
 * @param {boolean} [options.discreet]  omit title/uploader from the caption
 */
export async function fetchAndSend(m, url, { audio = false, discreet = false } = {}) {
  if (!isUrl(url)) return m.reply('Give me a link, e.g. `.dl https://…`');

  const bar = await status(m, '🔎 Reading the link…');
  const info = await probe(url);

  await bar.update(
    discreet ? '⏬ Downloading…' : `⏬ Downloading *${truncate(info.title, 50)}*…`,
  );
  const { buffer, ext } = await download(url, { audio, info });

  await bar.update(`📤 Sending — ${bytes(buffer.length)}…`);

  const isAudio = audio || ['mp3', 'm4a', 'opus', 'ogg'].includes(ext);
  await m.reply(
    isAudio
      ? { audio: buffer, mimetype: 'audio/mpeg', fileName: `audio.${ext}` }
      : {
          video: buffer,
          mimetype: 'video/mp4',
          caption: discreet ? undefined : infoHeader(info),
          // Sent view-once so it is not retained in the chat by default.
          ...(discreet ? { viewOnce: true } : {}),
        },
  );

  return bar.update('✅ Sent.');
}

export default { resolveTarget, status, infoHeader, fetchAndSend };
