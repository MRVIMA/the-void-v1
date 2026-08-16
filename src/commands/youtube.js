import { command } from '../core/registry.js';
import { resolveTarget, status } from '../lib/deliver.js';
import { probe } from '../lib/ytdlp.js';
import {
  beginDownloadFlow,
  cancelDownloadRequest,
  executeDownload,
  getDownloadRequest,
  selectDownloadQuality,
  showQualityMenu,
} from '../lib/download-flow.js';

command(
  {
    name: 'youtube',
    alias: ['yt', 'ytdl'],
    category: 'download',
    desc: 'Preview and choose format, quality and delivery type',
    usage: '.youtube song name · .youtube https://youtu.be/…',
    react: '▶️',
    cooldown: 10_000,
  },
  async ({ sock, m, text, prefix }) => {
    if (!text) return m.reply(`Usage: *${prefix}youtube <video name or YouTube link>*`);
    const bar = await status(m, '🔎 Reading the link…');
    const url = await resolveTarget(text);
    const info = await probe(url);
    await bar.update('✅ Link verified. Choose below.');
    return beginDownloadFlow(sock, m, { url, info, prefix });
  },
);

command(
  { name: 'dlformat', category: 'download', desc: 'Internal download format selector', hidden: true },
  async ({ sock, m, args, prefix }) => {
    const [token, type] = args;
    if (!token || !['audio', 'video'].includes(type)) throw new Error('Invalid format selection.');
    getDownloadRequest(token, m);
    return showQualityMenu(sock, m, token, type, prefix);
  },
);

command(
  { name: 'dlquality', category: 'download', desc: 'Internal download quality selector', hidden: true },
  async ({ sock, m, args, prefix }) => {
    const [token, quality] = args;
    return selectDownloadQuality(sock, m, token, quality, prefix);
  },
);

command(
  { name: 'dldeliver', category: 'download', desc: 'Internal audio delivery selector', hidden: true },
  async ({ m, args }) => {
    const [token, delivery] = args;
    return executeDownload(m, token, delivery);
  },
);

command(
  { name: 'dlcancel', category: 'download', desc: 'Cancel a pending download menu', hidden: true },
  async ({ m, args }) => {
    cancelDownloadRequest(args[0], m);
    return m.reply('❌ Download cancelled.');
  },
);

