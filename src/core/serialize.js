import { downloadMediaMessage, getContentType, jidNormalizedUser } from 'baileys';
import { baileysLogger } from '../lib/logger.js';
import { digits, isGroup as jidIsGroup } from '../lib/jid.js';

/**
 * Turns a raw Baileys message into a flat, predictable object.
 *
 * Raw messages are deeply nested and the same logical field lives in a
 * different place depending on type, whether the chat is ephemeral, and
 * whether the message was sent view-once. Commands should never have to know
 * any of that.
 */

const MEDIA_TYPES = new Set([
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'stickerMessage',
  'documentMessage',
]);

/** Peels off the wrapper layers WhatsApp adds around the real content. */
function unwrap(message) {
  let inner = message;
  for (let i = 0; i < 5 && inner; i++) {
    const type = getContentType(inner);
    if (type === 'ephemeralMessage') inner = inner.ephemeralMessage.message;
    else if (type === 'viewOnceMessage') inner = inner.viewOnceMessage.message;
    else if (type === 'viewOnceMessageV2') inner = inner.viewOnceMessageV2.message;
    else if (type === 'viewOnceMessageV2Extension') inner = inner.viewOnceMessageV2Extension.message;
    else if (type === 'documentWithCaptionMessage') inner = inner.documentWithCaptionMessage.message;
    else break;
  }
  return inner ?? message;
}

/** Extracts the user-visible text regardless of message type. */
function extractText(content, type) {
  if (!content || !type) return '';
  const node = content[type];
  if (type === 'conversation') return content.conversation ?? '';
  if (typeof node === 'string') return node;
  return (
    node?.text ??
    node?.caption ??
    node?.selectedButtonId ??
    node?.singleSelectReply?.selectedRowId ??
    node?.selectedId ??
    node?.contentText ??
    node?.selectedDisplayText ??
    node?.title ??
    node?.name ??
    ''
  );
}

/** Button / list / native-flow replies carry their payload in odd places. */
function extractInteractive(content, type) {
  if (type === 'templateButtonReplyMessage') {
    return content.templateButtonReplyMessage?.selectedId ?? '';
  }
  if (type === 'buttonsResponseMessage') {
    return content.buttonsResponseMessage?.selectedButtonId ?? '';
  }
  if (type === 'listResponseMessage') {
    return content.listResponseMessage?.singleSelectReply?.selectedRowId ?? '';
  }
  if (type === 'interactiveResponseMessage') {
    try {
      const raw = content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
      return raw ? (JSON.parse(raw)?.id ?? '') : '';
    } catch {
      return '';
    }
  }
  return '';
}

function buildQuoted(contextInfo, chat) {
  const quotedMessage = contextInfo?.quotedMessage;
  if (!quotedMessage) return null;

  const content = unwrap(quotedMessage);
  const type = getContentType(content);
  const participant = contextInfo.participant ? jidNormalizedUser(contextInfo.participant) : '';

  return {
    key: {
      remoteJid: contextInfo.remoteJid || chat,
      id: contextInfo.stanzaId,
      participant,
      fromMe: false,
    },
    message: content,
    type,
    text: extractText(content, type),
    sender: participant,
    senderNumber: digits(participant),
    isMedia: MEDIA_TYPES.has(type),
    mimetype: content?.[type]?.mimetype ?? null,
    /** Downloads the quoted media as a Buffer. */
    download: () =>
      downloadMediaMessage(
        { key: { remoteJid: contextInfo.remoteJid || chat, id: contextInfo.stanzaId, participant }, message: content },
        'buffer',
        {},
        { logger: baileysLogger, reuploadRequest: undefined },
      ),
  };
}

/**
 * @param {import('baileys').WASocket} sock
 * @param {object} raw a message from the `messages.upsert` event
 */
export function serialize(sock, raw) {
  if (!raw?.message) return null;

  const content = unwrap(raw.message);
  const type = getContentType(content);
  const chat = jidNormalizedUser(raw.key.remoteJid ?? '');
  const isGroup = jidIsGroup(raw.key.remoteJid);
  const fromMe = Boolean(raw.key.fromMe);

  // In a group the real author is `participant`; in a DM it's the chat itself.
  const sender = jidNormalizedUser(
    fromMe ? (sock.user?.id ?? '') : (raw.key.participant ?? raw.key.remoteJid ?? ''),
  );

  const contextInfo = content?.[type]?.contextInfo ?? null;
  const text = extractText(content, type) || extractInteractive(content, type);

  const m = {
    raw,
    key: raw.key,
    id: raw.key.id,
    chat,
    isGroup,
    isPrivate: !isGroup,
    fromMe,
    sender,
    senderNumber: digits(sender),
    pushName: raw.pushName || '',
    timestamp: Number(raw.messageTimestamp) || Math.floor(Date.now() / 1000),

    type,
    content,
    msg: content?.[type] ?? null,
    text: typeof text === 'string' ? text.trim() : '',
    isMedia: MEDIA_TYPES.has(type),
    mimetype: content?.[type]?.mimetype ?? null,
    isViewOnce: Boolean(
      raw.message.viewOnceMessage ||
        raw.message.viewOnceMessageV2 ||
        raw.message.viewOnceMessageV2Extension ||
        content?.[type]?.viewOnce,
    ),

    mentions: contextInfo?.mentionedJid ?? [],
    quoted: buildQuoted(contextInfo, chat),

    /* ── bound helpers ─────────────────────────────────────────────────── */

    reply: (content_, options = {}) =>
      sock.sendMessage(
        chat,
        typeof content_ === 'string' ? { text: content_ } : content_,
        { quoted: raw, ...options },
      ),

    send: (content_, options = {}) =>
      sock.sendMessage(chat, typeof content_ === 'string' ? { text: content_ } : content_, options),

    react: (emoji) => sock.sendMessage(chat, { react: { text: emoji, key: raw.key } }).catch(() => null),

    edit: (text_) => sock.sendMessage(chat, { text: text_, edit: raw.key }),

    delete: () => sock.sendMessage(chat, { delete: raw.key }),

    /** Downloads this message's own media as a Buffer. */
    download: () =>
      downloadMediaMessage(raw, 'buffer', {}, { logger: baileysLogger, reuploadRequest: sock.updateMediaMessage }),
  };

  /**
   * The media a command should act on: the quoted message when the user
   * replied to something, otherwise the message itself. This is what almost
   * every media command actually wants.
   */
  m.target = m.quoted?.isMedia ? m.quoted : m.isMedia ? m : null;

  return m;
}

export default serialize;
