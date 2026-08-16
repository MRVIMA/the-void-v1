import { command } from '../core/registry.js';
import config from '../config.js';
import { DEFAULT_SETTINGS, bans, settings as botSettings } from '../store/index.js';
import { card, truncate } from '../lib/format.js';
import { digits, toJid } from '../lib/jid.js';
import { header, hud, footer, fit, withBanner, RULE } from '../lib/menu.js';

/** Coerces `.set` input to the type of the existing default. */
function coerce(key, raw) {
  const current = DEFAULT_SETTINGS[key];
  if (typeof current === 'boolean') {
    if (!['true', 'false', 'on', 'off', '1', '0', 'yes', 'no'].includes(raw.toLowerCase())) {
      throw new Error(`${key} is a switch — use on or off`);
    }
    return ['true', 'on', '1', 'yes'].includes(raw.toLowerCase());
  }
  if (typeof current === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
    return n;
  }
  return raw;
}

/** Settings grouped for display. Anything unlisted lands in "other". */
const SETTING_GROUPS = {
  core: ['prefix', 'mode'],
  automation: ['autoRead', 'autoReadStatus', 'autoReactStatus', 'statusReactEmoji', 'alwaysOnline', 'autoTyping', 'autoRecording', 'aiChat'],
  protection: ['antiDelete', 'antiDeleteTarget', 'antiCall', 'antiCallAction'],
  chat: ['welcome', 'goodbye', 'reactToCommands', 'errorDetails', 'adultCommands'],
};

/** Booleans render as marks; everything else as its value. */
const renderValue = (v) => (v === true ? '✅' : v === false ? '❌' : String(v));

command(
  {
    name: 'settings',
    alias: ['config', 'env', 'settingsmenu'],
    category: 'owner',
    desc: 'View and change runtime settings',
    usage: '.settings',
    ownerOnly: true,
    react: '⚙️',
  },
  async ({ m, prefix }) => {
    const all = await botSettings.all();
    const shown = new Set();

    const blocks = Object.entries(SETTING_GROUPS).map(([group, keys]) => {
      const rows = keys.filter((k) => k in all).map((k) => {
        shown.add(k);
        return [k, renderValue(all[k])];
      });
      return hud(group, rows);
    });

    const rest = Object.keys(all).filter((k) => !shown.has(k));
    if (rest.length) blocks.push(hud('other', rest.map((k) => [k, renderValue(all[k])])));

    const caption =
      `⚙️  ${header('settings', `${config.BOT_NAME} · runtime configuration`)}\n\n` +
      blocks.join('\n\n') +
      `\n\n${RULE}\n` +
      footer([
        `\`${prefix}set <key> <value>\` — change one`,
        `\`${prefix}mode <private|public>\` — access`,
        `\`${prefix}system\` — host diagnostics`,
      ]);

    return withBanner(m, 'settings', fit(caption, prefix));
  },
);

command(
  {
    name: 'set',
    category: 'owner',
    desc: 'Change a runtime setting',
    usage: '.set antiDelete on',
    ownerOnly: true,
    react: '✅',
  },
  async ({ m, args, prefix }) => {
    const [key, ...rest] = args;
    if (!key) return m.reply(`Usage: *${prefix}set <key> <value>*\nSee *${prefix}settings* for the list.`);

    // Case-insensitive match against the known keys.
    const realKey = Object.keys(DEFAULT_SETTINGS).find((k) => k.toLowerCase() === key.toLowerCase());
    if (!realKey) return m.reply(`❔ Unknown setting *${key}*. See *${prefix}settings*.`);
    if (!rest.length) return m.reply(`Current value of *${realKey}*: \`${await botSettings.get(realKey)}\``);

    let value;
    try {
      value = coerce(realKey, rest.join(' '));
    } catch (err) {
      return m.reply(`⚠️ ${err.message}`);
    }

    await botSettings.set(realKey, value);
    return m.reply(`✅ *${realKey}* is now \`${value}\``);
  },
);

command(
  {
    name: 'mode',
    category: 'owner',
    desc: 'Switch who may use the bot',
    usage: '.mode public',
    ownerOnly: true,
    react: '🔀',
  },
  async ({ m, args }) => {
    const valid = ['private', 'public', 'group', 'inbox'];
    const next = args[0]?.toLowerCase();
    if (!valid.includes(next)) {
      return m.reply(`Mode must be one of: ${valid.join(', ')}\nCurrent: *${await botSettings.get('mode')}*`);
    }
    await botSettings.set('mode', next);
    return m.reply(`🔀 Mode set to *${next}*.`);
  },
);

command(
  {
    name: 'prefix',
    category: 'owner',
    desc: 'Change the command prefix',
    usage: '.prefix !',
    ownerOnly: true,
    react: '🔤',
  },
  async ({ m, args }) => {
    const next = args[0];
    if (!next || next.length > 3) return m.reply('Give a prefix of 1–3 characters, e.g. `.prefix !`');
    await botSettings.set('prefix', next);
    return m.reply(`🔤 Prefix is now \`${next}\` — commands look like \`${next}menu\`.`);
  },
);

/* ── bans ────────────────────────────────────────────────────────────────── */

const targetOf = (m, args) =>
  m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : '');

command(
  {
    name: 'ban',
    category: 'owner',
    desc: 'Stop a user from using the bot',
    usage: '.ban @user [reason]',
    ownerOnly: true,
    react: '🚫',
  },
  async ({ m, args }) => {
    const jid = targetOf(m, args);
    if (!jid) return m.reply('Mention, reply to, or give the number of the person to ban.');
    const number = digits(jid);
    await bans.ban(number, args.slice(1).join(' '));
    return m.reply(`🚫 Banned *${number}* from using the bot.`);
  },
);

command(
  {
    name: 'unban',
    category: 'owner',
    desc: 'Lift a ban',
    usage: '.unban @user',
    ownerOnly: true,
    react: '♻️',
  },
  async ({ m, args }) => {
    const jid = targetOf(m, args);
    if (!jid) return m.reply('Mention, reply to, or give the number to unban.');
    const number = digits(jid);
    const existed = await bans.unban(number);
    return m.reply(existed ? `♻️ Unbanned *${number}*.` : `*${number}* was not banned.`);
  },
);

command(
  {
    name: 'banlist',
    category: 'owner',
    desc: 'Show everyone currently banned',
    ownerOnly: true,
    react: '📋',
  },
  async ({ m }) => {
    const list = await bans.list();
    if (!list.length) return m.reply('Nobody is banned.');
    return m.reply(
      card(
        `Banned (${list.length})`,
        list.map((b) => [b.key, truncate(b.value?.reason || '—', 30)]),
      ),
    );
  },
);

/* ── account ─────────────────────────────────────────────────────────────── */

command(
  {
    name: 'block',
    category: 'owner',
    desc: 'Block a contact on WhatsApp itself',
    usage: '.block @user',
    ownerOnly: true,
    react: '⛔',
  },
  async ({ m, sock, args }) => {
    const jid = targetOf(m, args);
    if (!jid) return m.reply('Mention, reply to, or give the number to block.');
    await sock.updateBlockStatus(jid, 'block');
    return m.reply(`⛔ Blocked *${digits(jid)}*.`);
  },
);

command(
  {
    name: 'unblock',
    category: 'owner',
    desc: 'Unblock a contact',
    usage: '.unblock @user',
    ownerOnly: true,
    react: '✅',
  },
  async ({ m, sock, args }) => {
    const jid = targetOf(m, args);
    if (!jid) return m.reply('Mention, reply to, or give the number to unblock.');
    await sock.updateBlockStatus(jid, 'unblock');
    return m.reply(`✅ Unblocked *${digits(jid)}*.`);
  },
);

command(
  {
    name: 'restart',
    category: 'owner',
    desc: 'Restart the bot process',
    ownerOnly: true,
    react: '🔄',
  },
  async ({ m }) => {
    await m.reply('🔄 Restarting… I will be back in a few seconds.');
    // Exiting cleanly hands control to the process manager (pm2, systemd,
    // Docker, `node --watch`). Nothing is deleted — unlike the original
    // project's update command, which wiped its own source first.
    setTimeout(() => process.exit(0), 1000);
  },
);
