import config from '../config.js';
import { log } from '../lib/logger.js';
import { bans, settings as botSettings, groups, sudoAccess } from '../store/index.js';
import { selfIds, toNumber } from '../lib/jid.js';
import * as group from './group.js';
import { resolve } from './registry.js';
import { remember } from './msgcache.js';
import serialize from './serialize.js';
import { consumeMenuReply } from '../lib/interactive.js';

const logger = log('handler');

/* ── passive hooks ───────────────────────────────────────────────────────── */

const passiveHooks = [];

/**
 * Registers a hook that sees every message, command or not — antilink,
 * auto-reply, afk, and so on. A hook returning `true` stops further
 * processing, which is how a moderation action cancels command dispatch.
 */
export const usePassive = (fn) => passiveHooks.push(fn);

/* ── rate limiting ───────────────────────────────────────────────────────── */

const buckets = new Map(); // number -> { count, resetAt }
const cooldowns = new Map(); // `${number}:${command}` -> expiry

function rateLimited(number) {
  const now = Date.now();
  const bucket = buckets.get(number);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(number, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count++;
  return bucket.count > config.RATE_LIMIT_PER_MIN;
}

function onCooldown(number, name, ms) {
  if (!ms) return 0;
  const key = `${number}:${name}`;
  const until = cooldowns.get(key) ?? 0;
  const now = Date.now();
  if (until > now) return until - now;
  cooldowns.set(key, now + ms);
  return 0;
}

// Keep the maps from growing without bound on a busy bot.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  for (const [k, v] of cooldowns) if (now > v) cooldowns.delete(k);
}, 300_000).unref();

/* ── dispatch ────────────────────────────────────────────────────────────── */

export async function handleMessage(sock, raw) {
  const m = serialize(sock, raw);
  if (!m) return;

  // Never react to our own reactions or to protocol noise.
  if (m.type === 'reactionMessage' || m.type === 'protocolMessage') return;
  if (m.chat === 'status@broadcast') return;

  remember(raw);

  /* identity — resolved once, reused by every check below */
  const number = m.fromMe ? [...selfIds(sock)].find((v) => /^\d+$/.test(v)) ?? '' : await toNumber(sock, m.sender);
  const isSelf = m.fromMe;
  const isOwner = isSelf || (number && config.OWNER_NUMBERS.includes(number));
  const isSudo =
    isOwner ||
    Boolean(number && config.SUDO_NUMBERS.includes(number)) ||
    Boolean(number && (await sudoAccess.has(number)));

  /* hard blocks, before anything else runs */
  if (!isSudo) {
    if (number && config.BLOCKED_NUMBERS.includes(number)) return;
    if (config.BLOCKED_GROUPS.includes(m.chat)) return;
    if (number && (await bans.isBanned(number))) return;
    if (m.isGroup && (await bans.isBanned(m.chat))) return;
  }

  /* group context */
  const meta = m.isGroup ? await group.metadata(sock, m.chat) : null;
  const groupSettings = m.isGroup ? await groups.get(m.chat) : null;
  const isGroupSudo = Boolean(
    m.isGroup &&
    number &&
    Array.isArray(groupSettings?.privateSudo) &&
    groupSettings.privateSudo.includes(number),
  );
  const isAdmin = m.isGroup ? isSudo || isGroupSudo || group.isAdmin(meta, m.sender) : false;
  const isBotAdmin = m.isGroup ? [...selfIds(sock)].some((id) => group.isAdmin(meta, id)) : false;

  const settings = await botSettings.all();
  const prefix = settings.prefix || config.PREFIX;

  const ctx = {
    sock,
    m,
    number,
    isSelf,
    isOwner,
    isSudo,
    isGroupSudo,
    isAdmin,
    isBotAdmin,
    meta,
    settings,
    groupSettings,
    prefix,
    reply: m.reply,
    react: m.react,
  };

  /* passive features run before commands so moderation wins */
  for (const hook of passiveHooks) {
    try {
      if (await hook(ctx)) return;
    } catch (err) {
      logger.error({ err: err.message, hook: hook.name }, 'passive hook failed');
    }
  }

  if (settings.autoRead) await sock.readMessages([m.key]).catch(() => {});

  /* command parsing */
  // Reliable text menus use a quoted numeric reply ("1", "2", ...). Turn it
  // back into the hidden command ID before normal command parsing.
  const menuCommand = consumeMenuReply(m);
  if (menuCommand) m.text = menuCommand;

  if (!m.text?.startsWith(prefix)) return;
  const [word, ...args] = m.text.slice(prefix.length).trim().split(/\s+/);
  if (!word) return;

  const cmd = resolve(word);
  if (!cmd) return; // unknown commands stay silent — the bot is not a chatbot

  /* mode gating: who is allowed to run anything at all */
  const mode = settings.mode || config.MODE;
  if (!isSudo) {
    // An owner can authorize a specific group without changing the global
    // private mode. Access never follows the user into DMs or another group.
    if (mode === 'private' && !(m.isGroup && groupSettings?.privateAccess)) return;
    if (mode === 'group' && !m.isGroup) return;
    if (mode === 'inbox' && m.isGroup) return;
  }
  if (m.isGroup && groupSettings?.mute && !isAdmin) return;

  /* per-command gates */
  if (cmd.ownerOnly && !isSudo) return m.reply('🔒 This command is owner-only.');
  if (cmd.groupOnly && !m.isGroup) return m.reply('👥 This command only works in groups.');
  if (cmd.privateOnly && m.isGroup) return m.reply('📩 This command only works in direct messages.');
  if (cmd.adminOnly && !isAdmin) return m.reply('🛡️ Only group admins can use this command.');
  if (cmd.botAdmin && !isBotAdmin) return m.reply('⚠️ I need to be a group admin to do that.');
  // Two independent gates: a global kill switch the owner controls, and a
  // per-chat opt-in. Both must be on, and neither defaults to on.
  if (cmd.nsfw && !settings.adultCommands) {
    return m.reply(`🔞 Adult commands are switched off. Owner: \`${prefix}set adultCommands on\``);
  }
  if (cmd.nsfw && !groupSettings?.nsfw && !isSudo) {
    return m.reply(
      m.isGroup
        ? `🔞 Not enabled in this group. An admin can allow it with \`${prefix}nsfw on\`.`
        : '🔞 Adult commands are owner-only in direct messages.',
    );
  }

  const missing = cmd.requires.filter((key) => !config[key]);
  if (missing.length) {
    return m.reply(`🔧 This command needs ${missing.join(', ')} set in your .env file.`);
  }

  /* throttling — owners are exempt so the bot never locks its operator out */
  if (!isSudo) {
    if (rateLimited(number || m.sender)) {
      logger.debug({ number }, 'rate limited');
      return;
    }
    const wait = onCooldown(number || m.sender, cmd.name, cmd.cooldown || config.COMMAND_COOLDOWN_MS);
    if (wait) return m.react('⏳');
  }

  /* execute */
  if (cmd.react && settings.reactToCommands) m.react(cmd.react);

  const started = Date.now();
  try {
    await cmd.handler({ ...ctx, args, text: args.join(' '), command: cmd.name });
    logger.info({ cmd: cmd.name, ms: Date.now() - started, chat: m.chat }, 'command ok');
  } catch (err) {
    logger.error({ cmd: cmd.name, err: err.stack }, 'command failed');
    const detail = settings.errorDetails && isOwner ? `\n\n\`\`\`${String(err.stack).slice(0, 700)}\`\`\`` : '';
    await m
      .reply(`❌ *${cmd.name}* failed: ${err.message || 'unknown error'}${detail}`)
      .catch(() => {});
  }
}

export default { handleMessage, usePassive };
