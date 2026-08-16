import { command } from '../core/registry.js';
import config from '../config.js';
import {
  audioFilter,
  brandSticker,
  detectType,
  imageToCaptionSticker,
  imageToSticker,
  stickerToImage,
  toMp3,
  toVoiceNote,
  videoToSticker,
} from '../lib/media.js';
import { bytes } from '../lib/format.js';

/** Grabs the media to work on, or explains what the user should have done. */
async function grab(m, { want = 'media', maxMb = config.MAX_UPLOAD_MB } = {}) {
  const target = m.target;
  if (!target) throw new Error(`Send or reply to ${want === 'media' ? 'an image, video or audio' : want}.`);

  const size = target.msg?.fileLength ?? target.message?.[target.type]?.fileLength ?? 0;
  if (size && Number(size) > maxMb * 1024 * 1024) {
    throw new Error(`That file is ${bytes(Number(size))} — the limit is ${maxMb} MB.`);
  }

  const buffer = await target.download();
  if (!buffer?.length) throw new Error('The download came back empty — try sending the file again.');
  return { buffer, target };
}

command(
  {
    name: 'sticker',
    alias: ['s', 'stiker'],
    category: 'tools',
    desc: 'Turn an image, video or GIF into a sticker',
    usage: '.sticker [pack name]',
    react: '🩹',
    cooldown: 4000,
  },
  async ({ m, text }) => {
    const { buffer, target } = await grab(m);
    const { mime } = await detectType(buffer);

    const animated = mime.startsWith('video') || target.type === 'videoMessage';
    let webp = animated ? await videoToSticker(buffer) : await imageToSticker(buffer);

    const [pack, author] = text.split('|').map((s) => s?.trim());
    webp = await brandSticker(webp, {
      pack: pack || config.BOT_NAME,
      author: author || config.OWNER_NAME,
    });

    return m.reply({ sticker: webp });
  },
);

command(
  {
    name: 'captionsticker',
    alias: ['csticker', 'memesticker', 'stickercaption'],
    category: 'tools',
    desc: 'Turn an image into a sticker with caption text',
    usage: '.captionsticker your caption (reply to an image)',
    react: '💬',
    cooldown: 4000,
  },
  async ({ m, text }) => {
    const caption = text.trim();
    if (!caption) return m.reply('Reply to an image with `.captionsticker your caption`.');
    if (caption.length > 180) return m.reply('Keep the sticker caption under 180 characters.');

    const { buffer, target } = await grab(m, { want: 'an image' });
    const { mime } = await detectType(buffer);
    if (!mime.startsWith('image') || target.type === 'stickerMessage') {
      return m.reply('Caption stickers currently support images. Reply to a photo and try again.');
    }

    let webp = await imageToCaptionSticker(buffer, caption);
    webp = await brandSticker(webp, { pack: config.BOT_NAME, author: config.OWNER_NAME });
    return m.reply({ sticker: webp });
  },
);

command(
  {
    name: 'toimage',
    alias: ['toimg'],
    category: 'tools',
    desc: 'Convert a sticker back to an image',
    react: '🖼️',
    cooldown: 4000,
  },
  async ({ m }) => {
    if (m.quoted?.type !== 'stickerMessage') return m.reply('Reply to a sticker.');
    const buffer = await m.quoted.download();
    const png = await stickerToImage(buffer);
    return m.reply({ image: png, caption: '🖼️ Here you go.' });
  },
);

command(
  {
    name: 'tovoice',
    alias: ['toptt', 'tovn'],
    category: 'tools',
    desc: 'Convert audio or a video to a voice note',
    react: '🎙️',
    cooldown: 5000,
  },
  async ({ m }) => {
    const { buffer } = await grab(m, { want: 'an audio or video message' });
    const ogg = await toVoiceNote(buffer);
    return m.reply({ audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true });
  },
);

command(
  {
    name: 'tomp3',
    alias: ['toaudio'],
    category: 'tools',
    desc: 'Extract the audio track as MP3',
    react: '🎵',
    cooldown: 5000,
  },
  async ({ m }) => {
    const { buffer } = await grab(m, { want: 'a video or audio message' });
    const mp3 = await toMp3(buffer);
    return m.reply({ audio: mp3, mimetype: 'audio/mpeg', fileName: 'audio.mp3' });
  },
);

/* ── audio effects ───────────────────────────────────────────────────────── */

const EFFECTS = {
  bass: 'bass=g=15,dynaudnorm=f=200',
  deep: 'atempo=4/4,asetrate=44100*0.8',
  fast: 'atempo=1.63,asetrate=44100',
  slow: 'atempo=0.7,asetrate=44100',
  nightcore: 'atempo=1.06,asetrate=44100*1.25',
  robot: 'afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75',
  reverse: 'areverse',
  chipmunk: 'atempo=0.9,asetrate=65100',
};

for (const [name, filter] of Object.entries(EFFECTS)) {
  command(
    {
      name,
      category: 'audio',
      desc: `Apply the ${name} effect to audio`,
      usage: `.${name} (reply to audio)`,
      react: '🎚️',
      cooldown: 6000,
    },
    async ({ m }) => {
      const { buffer } = await grab(m, { want: 'an audio message' });
      const out = await audioFilter(buffer, filter);
      return m.reply({ audio: out, mimetype: 'audio/mpeg', fileName: `${name}.mp3` });
    },
  );
}

command(
  {
    name: 'vv',
    alias: ['reveal'],
    category: 'tools',
    desc: 'Re-send a view-once message you can see',
    ownerOnly: true,
    react: '👁️',
  },
  async ({ m }) => {
    const target = m.quoted;
    if (!target?.isMedia) return m.reply('Reply to the view-once photo, video or voice note.');

    const buffer = await target.download();
    const { mime } = await detectType(buffer);
    const kind = mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'image';

    return m.reply({ [kind]: buffer, caption: kind === 'audio' ? undefined : '👁️ Revealed' });
  },
);
