import config from '../config.js';
import { usePassive } from '../core/handler.js';
import { NS, getStore } from '../store/index.js';

const repliedAt = new Map();
const COOLDOWN = 5 * 60 * 1000;

const defaultMessage = (name) =>
  `🤖 *AUTOMATED AGENT*\n\n` +
  `Hello${name ? ` ${name}` : ''}! Thanks for your message. ` +
  `This is an automatic response from *${config.BOT_NAME}*. ` +
  `The owner is currently unavailable and will reply when possible.\n\n` +
  config.MENU_FOOTER;

usePassive(async function automaticAgent({ m, settings, prefix }) {
  if (!settings.autoReply || m.isGroup || m.fromMe || !m.text) return false;
  if (m.text.startsWith(prefix)) return false;

  const previous = repliedAt.get(m.chat) || 0;
  if (Date.now() - previous < COOLDOWN) return false;

  const custom = await getStore().get(NS.AUTOREPLY, 'message');
  const body = custom
    ? `🤖 *AUTOMATED AGENT*\n\n${custom}\n\n${config.MENU_FOOTER}`
    : defaultMessage(m.pushName);

  repliedAt.set(m.chat, Date.now());
  try {
    await m.reply(body);
  } catch (err) {
    repliedAt.delete(m.chat);
    throw err;
  }
  return false;
});

setInterval(() => {
  const cutoff = Date.now() - COOLDOWN;
  for (const [chat, at] of repliedAt) if (at < cutoff) repliedAt.delete(chat);
}, COOLDOWN).unref();
