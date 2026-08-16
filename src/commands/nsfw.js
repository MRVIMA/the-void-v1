import { command } from '../core/registry.js';
import { fetchAndSend } from '../lib/deliver.js';
import { isUrl } from '../lib/http.js';

/**
 * Adult-site downloads.
 *
 * These use the same yt-dlp engine as the ordinary download section — `.dl`
 * already handles these sites — so nothing new is possible here. What this
 * section adds is *gating*, which is the point:
 *
 *  - `nsfw: true` — the handler refuses unless the group has explicitly opted
 *    in with `.nsfw on`, or the caller is the owner. Off by default everywhere.
 *  - the `adultCommands` runtime setting is a global kill switch.
 *  - `hidden: true` — they never appear in `.menu`, so a family group's menu
 *    stays clean. `.nsfwmenu` lists them for anyone who wants them.
 *  - results are sent view-once and without titles, so they are not left
 *    sitting in the chat history with a descriptive caption.
 */

const GATE = { nsfw: true, hidden: true, category: 'nsfw', cooldown: 20_000 };

command(
  {
    ...GATE,
    name: 'nsfwdl',
    alias: ['xdl', 'adult'],
    desc: 'Download from an adult site link',
    usage: '.nsfwdl <url>',
    react: '🔞',
  },
  async ({ m, text }) => {
    const url = text.trim();
    if (!isUrl(url)) return m.reply('Give me a link, e.g. `.nsfwdl https://…`');
    return fetchAndSend(m, url, { discreet: true });
  },
);

command(
  {
    ...GATE,
    name: 'nsfwaudio',
    alias: ['xaudio'],
    desc: 'Download only the audio from an adult site link',
    usage: '.nsfwaudio <url>',
    react: '🔞',
  },
  async ({ m, text }) => {
    const url = text.trim();
    if (!isUrl(url)) return m.reply('Give me a link, e.g. `.nsfwaudio https://…`');
    return fetchAndSend(m, url, { audio: true, discreet: true });
  },
);

/** Thin site labels over the same implementation, as in the download section. */
const site = (name, alias, label, host) =>
  command(
    {
      ...GATE,
      name,
      alias,
      desc: `Download a video from ${label}`,
      usage: `.${name} https://${host}/…`,
      react: '🔞',
    },
    async ({ m, text }) => {
      const url = text.trim();
      if (!isUrl(url)) return m.reply(`Give me a ${label} link, e.g. \`.${name} https://${host}/…\``);
      if (!new URL(url).hostname.includes(host.split('.')[0])) {
        return m.reply(`That is not a ${label} link. Use \`.nsfwdl\` for other sites.`);
      }
      return fetchAndSend(m, url, { discreet: true });
    },
  );

site('pornhub', ['ph'], 'Pornhub', 'pornhub.com');
site('xvideos', ['xv'], 'XVideos', 'xvideos.com');
site('xnxx', [], 'XNXX', 'xnxx.com');
site('redtube', [], 'RedTube', 'redtube.com');
