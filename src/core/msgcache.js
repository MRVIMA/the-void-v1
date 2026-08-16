/**
 * Bounded in-memory cache of recent messages.
 *
 * Serves two jobs:
 *  - `getMessage` for Baileys, so a peer asking us to resend a message it
 *    failed to decrypt gets the real content instead of the "this message
 *    can take a while" placeholder.
 *  - anti-delete, which needs the body of a message *after* it was revoked.
 *
 * A plain Map preserves insertion order, so evicting the oldest key is enough
 * to keep memory flat. Nothing here is persisted — a restart starts clean by
 * design, since holding other people's deleted messages on disk is a liability.
 */

const MAX_ENTRIES = 1500;

const store = new Map();

const keyOf = (jid, id) => `${jid}|${id}`;

export function remember(message) {
  const jid = message?.key?.remoteJid;
  const id = message?.key?.id;
  if (!jid || !id || !message.message) return;

  const key = keyOf(jid, id);
  // Re-inserting moves the entry to the end, keeping hot messages alive.
  if (store.has(key)) store.delete(key);
  store.set(key, message);

  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value);
  }
}

export const recall = (jid, id) => store.get(keyOf(jid, id)) ?? null;

export const forget = (jid, id) => store.delete(keyOf(jid, id));

export const size = () => store.size;

/** The `getMessage` implementation handed to makeWASocket. */
export const getMessage = async (key) => recall(key.remoteJid, key.id)?.message ?? undefined;

export default { remember, recall, forget, size, getMessage };
