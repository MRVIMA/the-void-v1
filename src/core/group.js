import NodeCache from 'node-cache';
import { log } from '../lib/logger.js';
import { sameUser } from '../lib/jid.js';

const logger = log('group');

/**
 * Group metadata cache.
 *
 * Every outgoing group message makes Baileys ask for participant lists. Without
 * a cache that is a network round-trip per message and the single biggest
 * cause of rate-limit disconnects. Entries are invalidated on the events that
 * actually change membership rather than being trusted until expiry.
 */
const cache = new NodeCache({ stdTTL: 300, checkperiod: 120, useClones: false });

export async function metadata(sock, jid, { fresh = false } = {}) {
  if (!fresh) {
    const hit = cache.get(jid);
    if (hit) return hit;
  }
  try {
    const data = await sock.groupMetadata(jid);
    cache.set(jid, data);
    return data;
  } catch (err) {
    logger.debug({ jid, err: err.message }, 'group metadata fetch failed');
    return null;
  }
}

/** Passed to makeWASocket so Baileys reuses our cache for its own sends. */
export const cachedGroupMetadata = (sock) => async (jid) => cache.get(jid) ?? (await metadata(sock, jid));

export const invalidate = (jid) => cache.del(jid);

/** Applies a membership delta in place so we avoid a refetch per event. */
export function applyParticipantUpdate(jid, participants, action) {
  const data = cache.get(jid);
  if (!data) return;

  if (action === 'add') {
    for (const id of participants) {
      if (!data.participants.some((p) => p.id === id)) data.participants.push({ id, admin: null });
    }
  } else if (action === 'remove') {
    data.participants = data.participants.filter((p) => !participants.includes(p.id));
  } else if (action === 'promote' || action === 'demote') {
    for (const p of data.participants) {
      if (participants.includes(p.id)) p.admin = action === 'promote' ? 'admin' : null;
    }
  } else {
    cache.del(jid);
    return;
  }
  cache.set(jid, data);
}

/* ── membership queries ────────────────────────────────────────────────── */

/** All identifiers a participant record answers to (id, lid, phone number). */
const idsOf = (p) => [p.id, p.lid, p.phoneNumber].filter(Boolean);

export const isAdmin = (meta, jid) =>
  Boolean(
    meta?.participants?.some(
      (p) => (p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin) && sameUser(jid, idsOf(p)),
    ),
  );

export const isMember = (meta, jid) => Boolean(meta?.participants?.some((p) => sameUser(jid, idsOf(p))));

export const adminList = (meta) =>
  (meta?.participants ?? [])
    .filter((p) => p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin)
    .map((p) => p.id);

/** Resolves the participant record matching a jid, or null. */
export const participant = (meta, jid) => meta?.participants?.find((p) => sameUser(jid, idsOf(p))) ?? null;

export default { metadata, cachedGroupMetadata, invalidate, applyParticipantUpdate, isAdmin, isMember, adminList, participant };
