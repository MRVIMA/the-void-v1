import crypto from 'node:crypto';
import config from '../config.js';
import { bytes, compact, duration, truncate } from './format.js';
import { selectMenu } from './interactive.js';
import { download, queueDepth } from './ytdlp.js';
import { status, infoHeader } from './deliver.js';

const requests = new Map();
const TTL = 10 * 60 * 1000;

const cleanName = (name, ext) =>
  `${String(name || 'media').replace(/[\\/:*?"<>|]/g, '').slice(0, 110)}.${ext}`;

function details(request) {
  const info = request.info;
  const title = request.origin.title || info.title;
  return (
    `*${truncate(title, 80)}*\n` +
    `${info.uploader ? `👤 ${truncate(info.uploader, 50)}\n` : ''}` +
    `${info.duration ? `⏱ ${duration(info.duration)}\n` : ''}` +
    `${info.views ? `👁 ${compact(info.views)} views\n` : ''}` +
    `${info.extractor ? `🔗 ${info.extractor}` : ''}`
  ).trim();
}

function create(m, data) {
  const token = crypto.randomBytes(4).toString('hex');
  requests.set(token, {
    chat: m.chat,
    sender: m.sender,
    type: null,
    quality: null,
    origin: {},
    ...data,
    expiresAt: Date.now() + TTL,
  });
  return token;
}

export function getDownloadRequest(token, m) {
  const request = requests.get(token);
  if (!request || request.expiresAt < Date.now()) {
    requests.delete(token);
    throw new Error('That download menu expired. Start the command again.');
  }
  if (request.chat !== m.chat || request.sender !== m.sender) {
    throw new Error('That download menu belongs to another user.');
  }
  request.expiresAt = Date.now() + TTL;
  return request;
}

export function cancelDownloadRequest(token, m) {
  getDownloadRequest(token, m);
  requests.delete(token);
}

const cancelRow = (prefix, token) => ({
  title: 'Cancel',
  description: 'Do not download this link',
  id: `${prefix}dlcancel ${token}`,
});

export async function showQualityMenu(sock, m, token, type, prefix) {
  const request = getDownloadRequest(token, m);
  request.type = type;
  const qualities = type === 'audio'
    ? [
        ['96 kbps', 'Small file · data saver', '96'],
        ['128 kbps', 'Standard quality', '128'],
        ['192 kbps', 'High quality · recommended', '192'],
        ['320 kbps', 'Best MP3 quality · largest file', '320'],
      ]
    : [
        ['360p', 'Small file · data saver', '360'],
        ['480p', 'Standard definition', '480'],
        ['720p HD', 'High definition · recommended', '720'],
        ['1080p Full HD', 'Best quality · largest file', '1080'],
      ];

  return selectMenu(sock, m, {
    title: `${type === 'audio' ? 'Audio' : 'Video'} Quality`,
    body: `${details(request)}\n\nVerify the details, then choose quality:`,
    button: 'Select quality',
    footer: config.MENU_FOOTER,
    rows: [
      ...qualities.map(([title, description, quality]) => ({
        title,
        description,
        id: `${prefix}dlquality ${token} ${quality}`,
      })),
      cancelRow(prefix, token),
    ],
  });
}

export async function beginDownloadFlow(sock, m, { url, info, prefix, mode = 'both', origin = {}, discreet = false }) {
  const token = create(m, { url, info, origin, discreet });
  if (mode === 'audio' || mode === 'video') return showQualityMenu(sock, m, token, mode, prefix);

  const request = getDownloadRequest(token, m);
  return selectMenu(sock, m, {
    title: 'Download Information',
    body: `${details(request)}\n\nVerify the link details. What do you need?`,
    button: 'Select format',
    footer: config.MENU_FOOTER,
    rows: [
      {
        title: 'Audio',
        description: 'MP3 · choose quality and delivery type',
        id: `${prefix}dlformat ${token} audio`,
      },
      {
        title: 'Video',
        description: 'MP4 · choose video quality',
        id: `${prefix}dlformat ${token} video`,
      },
      cancelRow(prefix, token),
    ],
  });
}

export async function selectDownloadQuality(sock, m, token, qualityText, prefix) {
  const request = getDownloadRequest(token, m);
  if (!request.type) throw new Error('Choose audio or video first.');
  const quality = Number(qualityText);
  const allowed = request.type === 'audio' ? [96, 128, 192, 320] : [360, 480, 720, 1080];
  if (!allowed.includes(quality)) throw new Error('Invalid quality selection.');
  request.quality = quality;

  if (request.type === 'video') return executeDownload(m, token, 'media');

  return selectMenu(sock, m, {
    title: 'Audio Delivery',
    body: `${details(request)}\n\nQuality: *${quality} kbps*\nHow should I send the MP3?`,
    button: 'Select delivery type',
    footer: config.MENU_FOOTER,
    rows: [
      {
        title: 'Audio Type',
        description: 'Playable directly inside WhatsApp',
        id: `${prefix}dldeliver ${token} audio`,
      },
      {
        title: 'Document Type',
        description: 'Send as an MP3 file with its filename',
        id: `${prefix}dldeliver ${token} document`,
      },
      cancelRow(prefix, token),
    ],
  });
}

export async function executeDownload(m, token, delivery) {
  const request = getDownloadRequest(token, m);
  if (!request.type || !request.quality) throw new Error('Complete the format and quality selections first.');
  if (request.type === 'audio' && !['audio', 'document'].includes(delivery)) {
    throw new Error('Choose Audio Type or Document Type.');
  }

  requests.delete(token); // double-taps cannot spawn duplicate jobs
  const { active, waiting } = queueDepth();
  const unit = request.type === 'audio' ? ' kbps' : 'p';
  const bar = await status(
    m,
    `⏬ Downloading *${truncate(request.origin.title || request.info.title, 55)}* at ${request.quality}${unit}…` +
      (waiting ? ` (${active} running, queued)` : ''),
  );

  const result = await download(request.url, {
    audio: request.type === 'audio',
    audioBitrate: request.type === 'audio' ? request.quality : undefined,
    height: request.type === 'video' ? request.quality : undefined,
    info: request.info,
  });
  await bar.update(`📤 Sending — ${bytes(result.buffer.length)}…`);

  const title = request.origin.title || request.info.title;
  if (request.type === 'audio') {
    const common = {
      mimetype: 'audio/mpeg',
      fileName: cleanName(title, 'mp3'),
    };
    await m.reply(
      delivery === 'document'
        ? { document: result.buffer, ...common }
        : {
            audio: result.buffer,
            ...common,
            contextInfo: (request.origin.thumbnail || request.info.thumbnail)
              ? {
                  externalAdReply: {
                    title: truncate(title, 60),
                    body: `${request.quality} kbps · ${request.origin.label || request.info.uploader || 'Audio'}`,
                    thumbnailUrl: request.origin.thumbnail || request.info.thumbnail,
                    mediaType: 2,
                    sourceUrl: request.origin.url || request.info.webpage,
                  },
                }
              : undefined,
          },
    );
  } else {
    await m.reply({
      video: result.buffer,
      mimetype: 'video/mp4',
      fileName: cleanName(title, 'mp4'),
      caption: request.discreet
        ? config.MENU_FOOTER
        : `${infoHeader(request.info)}\n🎞 ${request.quality}p\n\n${config.MENU_FOOTER}`,
      ...(request.discreet ? { viewOnce: true } : {}),
    });
  }

  return bar.update(`✅ Sent at ${request.quality}${unit}.`);
}

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [token, request] of requests) if (request.expiresAt < now) requests.delete(token);
}, TTL);
cleanup.unref();

export const pendingDownloadCount = () => requests.size;

