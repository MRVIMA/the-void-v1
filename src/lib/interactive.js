import { generateWAMessageFromContent, proto } from 'baileys';
import config from '../config.js';

const textMenus = new Map();
const MENU_TTL = 10 * 60 * 1000;

const menuKey = (m) => `${m.chat}:${m.sender}`;

/**
 * Converts a numeric reply to the command ID behind that menu row. Requiring
 * the user to reply to the exact menu message prevents an ordinary "1" in the
 * conversation from triggering a download.
 */
export function consumeMenuReply(m) {
  if (!/^\d+$/.test(m.text || '')) return null;
  const entry = textMenus.get(menuKey(m));
  if (!entry || entry.expiresAt < Date.now()) {
    textMenus.delete(menuKey(m));
    return null;
  }
  if (!m.quoted?.key?.id || m.quoted.key.id !== entry.messageId) return null;
  const id = entry.rows[Number(m.text) - 1]?.id ?? null;
  if (id) textMenus.delete(menuKey(m));
  return id;
}

/**
 * Sends a native WhatsApp single-select menu. Row IDs are ordinary bot command
 * strings, which serialize.js already extracts from interactive replies.
 * Falls back to a text menu if WhatsApp rejects interactive messages for the
 * connected account type.
 */
export async function selectMenu(sock, m, { title, body, button = 'Choose', rows, footer = '' }) {
  const fallback =
    `*${title}*\n\n${body}\n\n` +
    rows.map((r, i) => `${i + 1}. *${r.title}*${r.description ? `\n   ${r.description}` : ''}`).join('\n\n') +
    `\n\n↩️ *Reply to this message with a number (1–${rows.length}).*` +
    (footer ? `\n\n${footer}` : '');

  // Native single-select lists are silently dropped for many personal linked
  // accounts (relayMessage resolves successfully, so no catch block runs).
  // Normal text messages plus quoted number replies work on every account.
  if (!config.INTERACTIVE_MENUS) {
    const sent = await m.reply(fallback);
    textMenus.set(menuKey(m), {
      messageId: sent.key.id,
      rows,
      expiresAt: Date.now() + MENU_TTL,
    });
    return sent;
  }

  try {
    const content = proto.Message.InteractiveMessage.create({
      header: proto.Message.InteractiveMessage.Header.create({ title, hasMediaAttachment: false }),
      body: proto.Message.InteractiveMessage.Body.create({ text: body }),
      footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: [
          {
            name: 'single_select',
            buttonParamsJson: JSON.stringify({
              title: button,
              sections: [{ title, rows }],
            }),
          },
        ],
      }),
    });

    const message = generateWAMessageFromContent(
      m.chat,
      {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2,
            },
            interactiveMessage: content,
          },
        },
      },
      { userJid: sock.user?.id, quoted: m.raw },
    );
    await sock.relayMessage(m.chat, message.message, { messageId: message.key.id });
    return message;
  } catch {
    const sent = await m.reply(fallback);
    textMenus.set(menuKey(m), {
      messageId: sent.key.id,
      rows,
      expiresAt: Date.now() + MENU_TTL,
    });
    return sent;
  }
}

export default selectMenu;
