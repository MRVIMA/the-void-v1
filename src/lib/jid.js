import { isJidGroup, isLidUser, isPnUser, jidNormalizedUser } from 'baileys';

/**
 * WhatsApp identity helpers.
 *
 * Baileys 7 exposes two identifiers for the same human: the phone number JID
 * (`94771234567@s.whatsapp.net`) and the LID (`123456789@lid`). Group
 * participants are increasingly delivered as LIDs, so any permission check
 * that compares raw JIDs will silently fail. Everything here funnels an
 * identity down to a plain phone number so comparisons stay reliable.
 */

/** `94771234567:12@s.whatsapp.net` -> `94771234567` */
export const digits = (jid = '') =>
  String(jid ?? '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');

export const isGroup = (jid) => Boolean(isJidGroup(jid));
export const isLid = (jid) => Boolean(isLidUser(jid));
export const isPn = (jid) => Boolean(isPnUser(jid));

/**
 * Resolves any JID to its phone number, consulting the socket's LID mapping
 * when needed. Returns digits only, or '' when the mapping is unknown.
 */
export async function toNumber(sock, jid) {
  if (!jid) return '';
  const normalized = jidNormalizedUser(jid);

  if (isLidUser(normalized)) {
    try {
      const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(normalized);
      if (pn) return digits(pn);
    } catch {
      /* mapping not cached yet — fall through to the raw value */
    }
    return ''; // a bare LID is not a phone number; never pretend it is
  }

  return digits(normalized);
}

/** The reverse lookup, used when we hold a number and need the LID form. */
export async function toLid(sock, jid) {
  if (!jid) return '';
  const normalized = jidNormalizedUser(jid);
  if (isLidUser(normalized)) return normalized;
  try {
    const lid = await sock?.signalRepository?.lidMapping?.getLIDForPN(normalized);
    return lid || '';
  } catch {
    return '';
  }
}

/**
 * Every identifier the bot itself answers to. Used so the bot recognises its
 * own messages and its own membership in a group regardless of which form
 * WhatsApp used.
 */
export function selfIds(sock) {
  const ids = new Set();
  const id = sock?.user?.id;
  const lid = sock?.user?.lid;
  if (id) {
    ids.add(jidNormalizedUser(id));
    ids.add(digits(id));
  }
  if (lid) {
    ids.add(jidNormalizedUser(lid));
    ids.add(digits(lid));
  }
  ids.delete('');
  return ids;
}

/**
 * True when `jid` refers to the same person as any entry in `candidates`.
 * Compares both JID forms and bare digits so LID/PN mismatches don't matter.
 */
export function sameUser(jid, candidates = []) {
  if (!jid) return false;
  const normalized = jidNormalizedUser(jid);
  const bare = digits(jid);
  const set = candidates instanceof Set ? candidates : new Set(candidates);
  if (set.has(normalized) || (bare && set.has(bare))) return true;
  for (const candidate of set) {
    if (!candidate) continue;
    if (jidNormalizedUser(String(candidate)) === normalized) return true;
    if (bare && digits(candidate) === bare) return true;
  }
  return false;
}

/** Builds `<number>@s.whatsapp.net` from loose user input. */
export const toJid = (input = '') => {
  const n = digits(input);
  return n ? `${n}@s.whatsapp.net` : '';
};

export default { digits, isGroup, isLid, isPn, toNumber, toLid, selfIds, sameUser, toJid };
