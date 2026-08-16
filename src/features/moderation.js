import { usePassive } from '../core/handler.js';
import { getStore, NS } from '../store/index.js';
import { log } from '../lib/logger.js';
import { digits } from '../lib/jid.js';

const logger = log('moderation');

const INVITE_LINK = /chat\.whatsapp\.com\/[0-9A-Za-z]{18,24}/i;
const CHANNEL_LINK = /whatsapp\.com\/channel\/[0-9A-Za-z]{18,30}/i;
const ANY_LINK = /https?:\/\/\S+|www\.\S+/i;

const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dickhead', 'motherfucker'];
const badWordPattern = new RegExp(`\\b(${BAD_WORDS.join('|')})\\b`, 'i');

/** Increments and returns a member's warning count for this group. */
async function warn(chat, number) {
  const store = getStore();
  const key = `${chat}:${number}`;
  const count = ((await store.get(NS.USER, key))?.warns ?? 0) + 1;
  await store.set(NS.USER, key, { warns: count, at: Date.now() });
  return count;
}

export async function clearWarns(chat, number) {
  return getStore().delete(NS.USER, `${chat}:${number}`);
}

/**
 * Applies the configured penalty. Returns true when the message was handled,
 * which stops the pipeline so a link never also triggers a command.
 */
async function punish({ sock, m, isBotAdmin, groupSettings }, { action, reason, limit }) {
  if (isBotAdmin) await sock.sendMessage(m.chat, { delete: m.key }).catch(() => {});

  if (action === 'delete') {
    await sock.sendMessage(m.chat, {
      text: `🚫 ${reason} removed — @${m.senderNumber}`,
      mentions: [m.sender],
    });
    return true;
  }

  const count = await warn(m.chat, m.senderNumber);

  if (action === 'warn' || count < limit) {
    await sock.sendMessage(m.chat, {
      text: `⚠️ @${m.senderNumber}, ${reason} is not allowed here. Warning *${count}/${limit}*.`,
      mentions: [m.sender],
    });
    return true;
  }

  if (!isBotAdmin) {
    await sock.sendMessage(m.chat, {
      text: `⚠️ @${m.senderNumber} hit the warning limit, but I am not an admin so I cannot remove them.`,
      mentions: [m.sender],
    });
    return true;
  }

  await sock.groupParticipantsUpdate(m.chat, [m.sender], 'remove').catch(() => {});
  await clearWarns(m.chat, m.senderNumber);
  await sock.sendMessage(m.chat, {
    text: `👢 Removed @${m.senderNumber} after ${count} warnings.`,
    mentions: [m.sender],
  });
  logger.info({ chat: m.chat, number: m.senderNumber, reason }, 'removed member');
  return true;
}

/** Anti-link and word filtering. Admins, sudo users and the bot are exempt. */
usePassive(async function moderation(ctx) {
  const { m, isAdmin, isSudo, groupSettings } = ctx;
  if (!m.isGroup || !groupSettings || m.fromMe || isAdmin || isSudo) return false;
  if (!m.text) return false;

  if (groupSettings.antilink) {
    const isInvite = INVITE_LINK.test(m.text) || CHANNEL_LINK.test(m.text);
    // `antilinkAction` of `kick` implies the strictest reading: any URL counts.
    const isLink = isInvite || (groupSettings.antilinkAction === 'kick' && ANY_LINK.test(m.text));
    if (isLink) {
      return punish(ctx, {
        action: groupSettings.antilinkAction,
        reason: 'link',
        limit: groupSettings.warnLimit ?? 3,
      });
    }
  }

  if (groupSettings.antibad && badWordPattern.test(m.text)) {
    return punish(ctx, {
      action: groupSettings.antibadAction ?? 'delete',
      reason: 'that language',
      limit: groupSettings.warnLimit ?? 3,
    });
  }

  return false;
});

logger.debug('moderation hooks registered');
