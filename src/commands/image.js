import { command } from '../core/registry.js';
import config from '../config.js';
import { generateImage, imageQueue } from '../lib/image-generator.js';
import { detectType } from '../lib/media.js';
import { status } from '../lib/deliver.js';
import { bytes, truncate } from '../lib/format.js';

const COMMON = {
  category: 'image',
  requires: ['GEMINI_API_KEY'],
  react: '🎨',
  cooldown: 30_000,
};

async function create(m, prompt, aspectRatio, label) {
  if (!prompt) return m.reply(`Describe the ${label.toLowerCase()} you want.`);
  const queue = imageQueue();
  const bar = await status(m, `🎨 Creating ${label.toLowerCase()}…${queue.active ? ` (${queue.waiting + 1} queued)` : ''}`);
  const result = await generateImage(prompt, { aspectRatio });
  await bar.update(`📤 Sending — ${bytes(result.buffer.length)}…`);
  await m.reply({
    image: result.buffer,
    mimetype: result.mimeType,
    caption: `🎨 *${label}*\n_${truncate(prompt, 220)}_\n\n${config.MENU_FOOTER}`,
  });
  return bar.update('✅ Image created.');
}

command(
  {
    ...COMMON,
    name: 'image',
    alias: ['imagine', 'draw', 'createimage'],
    desc: 'Create an AI image from a description',
    usage: '.image a neon city floating above the ocean',
  },
  async ({ m, text }) => create(m, text, '1:1', 'Generated Image'),
);

command(
  {
    ...COMMON,
    name: 'logo',
    alias: ['createlogo', 'logomaker'],
    desc: 'Create a clean professional logo',
    usage: '.logo THE VØID, black and crimson cyberpunk emblem',
  },
  async ({ m, text }) => {
    if (!text) return m.reply('Describe the brand and style, e.g. `.logo THE VØID, black and crimson cyberpunk emblem`');
    const prompt =
      `Create one professional, original logo based on this brief: ${text}. ` +
      'Centered composition, strong silhouette, clean edges, balanced spacing, no mockup, no wall, no stationery, no watermark. ' +
      'If the brief contains a brand name, reproduce that text accurately and do not add other words. Transparent or plain background.';
    return create(m, prompt, '1:1', 'Logo');
  },
);

command(
  {
    ...COMMON,
    name: 'wallpaper',
    alias: ['wall'],
    desc: 'Create a widescreen wallpaper',
    usage: '.wallpaper dark futuristic city in red fog',
  },
  async ({ m, text }) =>
    text
      ? create(m, `${text}. Cinematic widescreen wallpaper, no watermark.`, '16:9', 'Wallpaper')
      : m.reply('Describe the wallpaper you want.'),
);

command(
  {
    ...COMMON,
    name: 'poster',
    alias: ['createposter'],
    desc: 'Create a portrait poster',
    usage: '.poster sci-fi event called Into The Void',
  },
  async ({ m, text }) =>
    text
      ? create(m, `${text}. Professional portrait poster composition, no watermark.`, '3:4', 'Poster')
      : m.reply('Describe the poster you want.'),
);

command(
  {
    ...COMMON,
    name: 'avatar',
    alias: ['pfp'],
    desc: 'Create a square profile image',
    usage: '.avatar masked hacker with a crimson void halo',
  },
  async ({ m, text }) =>
    text
      ? create(m, `${text}. Square profile avatar, centered subject, readable at small size, no watermark.`, '1:1', 'Avatar')
      : m.reply('Describe the avatar you want.'),
);

command(
  {
    ...COMMON,
    name: 'editimage',
    alias: ['imgedit'],
    desc: 'Edit a quoted image using instructions',
    usage: '.editimage make the background dark red',
  },
  async ({ m, text }) => {
    const target = m.target;
    if (!target || !['imageMessage', 'stickerMessage'].includes(target.type)) {
      return m.reply('Reply to an image or sticker with editing instructions.');
    }
    if (!text) return m.reply('Tell me what to change in the quoted image.');

    const source = await target.download();
    const detected = await detectType(source);
    const bar = await status(m, '🎨 Editing the image…');
    const result = await generateImage(
      `Edit the supplied image as follows: ${text}. Preserve everything not mentioned. Do not add a watermark.`,
      { source, mimeType: detected.mime || target.mimetype || 'image/jpeg', aspectRatio: '1:1' },
    );
    await m.reply({
      image: result.buffer,
      mimetype: result.mimeType,
      caption: `🎨 *Edited Image*\n_${truncate(text, 220)}_\n\n${config.MENU_FOOTER}`,
    });
    return bar.update('✅ Image edited.');
  },
);
