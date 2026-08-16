import { getContentType, proto } from 'baileys';
import config from '../config.js';
import { log } from '../lib/logger.js';
import { template } from '../lib/format.js';
import { digits, selfIds } from '../lib/jid.js';
import { groups, settings as botSettings } from '../store/index.js';
import * as group from './group.js';
import { recall } from './msgcache.js';

const logger = log('events');

const REVOKE = proto.Message.ProtocolMessage.Type.REVOKE;

/* ── welcome / goodbye ───────────────────────────────────────────────────── */

const DEFAULT_WELCOME = '👋 Welcome {user} to *{group}*!';
const DEFAULT_GOODBYE = '👋 {user} has left *{group}*.';

async function onParticipantsUpdate(sock, { id, participants, action }) {
  group.applyParticipantUpdate(id, participants, action);

  if (action !== 'add' && action !== 'remove') return;

  const settings = await groups.get(id);
  const wants = action === 'add' ? settings.welcome : settings.goodbye;
  if (!wants) return;

  const meta = await group.metadata(sock, id);
  const self = selfIds(sock);

  for (const user of participants) {
    if (self.has(user) || self.has(digits(user))) continue; // don't greet ourselves

    const custom = action === 'add' ? settings.welcomeText : settings.goodbyeText;
    const text = template(custom || (action === 'add' ? DEFAULT_WELCOME : DEFAULT_GOODBYE), {
      user: `@${digits(user)}`,
      group: meta?.subject ?? 'the group',
      count: meta?.participants?.length ?? '',
    });

    await sock.sendMessage(id, { text, mentions: [user] }).catch((err) => {
      logger.debug({ err: err.message, id }, 'greeting failed');
    });
  }
}

/* ── anti-delete ─────────────────────────────────────────────────────────── */

/**
 * When someone revokes a message we already cached, forward the original.
 * Target `owner` sends it to the bot's own chat (discreet); `chat` posts it
 * back where it was deleted (confrontational, but what most people expect).
 */
async function onRevoke(sock, msg) {
  const content = msg.message?.protocolMessage;
  if (!content || content.type !== REVOKE) return;

  const settings = await botSettings.all();
  if (!settings.antiDelete) return;

  const key = content.key;
  const original = recall(key.remoteJid ?? msg.key.remoteJid, key.id);
  if (!original) return;

  const self = selfIds(sock);
  const author = original.key.participant ?? original.key.remoteJid;
  if (original.key.fromMe || self.has(author) || self.has(digits(author))) return; // ignore our own

  const type = getContentType(original.message);
  const body =
    original.message?.conversation ??
    original.message?.[type]?.text ??
    original.message?.[type]?.caption ??
    '';

  const target = settings.antiDeleteTarget === 'chat' ? original.key.remoteJid : sock.user.id;
  const header =
    `🗑️ *Deleted message recovered*\n` +
    `👤 @${digits(author)}\n` +
    (original.key.remoteJid?.endsWith('@g.us') ? `💬 ${(await group.metadata(sock, original.key.remoteJid))?.subject ?? 'group'}\n` : '') +
    `🕒 ${new Date(Number(original.messageTimestamp) * 1000).toLocaleString('en-GB', { timeZone: config.TIMEZONE })}`;

  await sock.sendMessage(target, { text: `${header}\n\n${body || '_(media message)_'}`, mentions: [author] }).catch(() => {});

  // Re-send the media itself when there was any.
  if (['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'].includes(type)) {
    await sock.sendMessage(target, { forward: original }).catch(() => {});
  }
}

/* ── calls ───────────────────────────────────────────────────────────────── */

async function onCall(sock, calls) {
  const settings = await botSettings.all();
  if (!settings.antiCall) return;

  for (const call of calls) {
    if (call.status !== 'offer') continue;
    const from = call.from;
    if (config.OWNER_NUMBERS.includes(digits(from))) continue;

    await sock.rejectCall(call.id, call.from).catch(() => {});
    await sock
      .sendMessage(from, { text: '📵 Calls are not accepted here. Please send a message instead.' })
      .catch(() => {});

    if (settings.antiCallAction === 'block') {
      await sock.updateBlockStatus(from, 'block').catch(() => {});
      logger.info({ from: digits(from) }, 'blocked caller');
    }
  }
}

/* ── presence ────────────────────────────────────────────────────────────── */

let presenceTimer = null;

async function keepOnline(sock) {
  clearInterval(presenceTimer);
  if (!(await botSettings.on('alwaysOnline'))) return;
  presenceTimer = setInterval(() => {
    sock.sendPresenceUpdate('available').catch(() => {});
  }, 60_000);
  presenceTimer.unref();
}

/* ── registration ────────────────────────────────────────────────────────── */

export function registerEvents(sock) {
  sock.ev.on('group-participants.update', (update) => {
    onParticipantsUpdate(sock, update).catch((err) => logger.error({ err: err.message }, 'participants update failed'));
  });

  sock.ev.on('groups.update', (updates) => {
    for (const u of updates) if (u.id) group.invalidate(u.id);
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.message?.protocolMessage) {
        onRevoke(sock, msg).catch((err) => logger.error({ err: err.message }, 'anti-delete failed'));
      }
    }
  });

  sock.ev.on('call', (calls) => {
    onCall(sock, calls).catch((err) => logger.error({ err: err.message }, 'call handling failed'));
  });

  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') keepOnline(sock).catch(() => {});
  });
}

export default registerEvents;
