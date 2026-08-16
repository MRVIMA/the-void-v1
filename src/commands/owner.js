import { command } from '../core/registry.js';
import config from '../config.js';
import { DEFAULT_SETTINGS, NS, bans, getStore, groups, settings as botSettings, sudoAccess } from '../store/index.js';
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
  automation: ['autoRead', 'autoReadStatus', 'autoReactStatus', 'statusReactEmoji', 'alwaysOnline', 'autoTyping', 'autoRecording', 'aiChat', 'autoReply'],
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

command(
  {
    name: 'autoreply',
    alias: ['ar'],
    category: 'owner',
    desc: 'Control the automated-agent reply for direct messages',
    usage: '.autoreply on · .autoreply off · .autoreply set <message>',
    ownerOnly: true,
    react: '🤖',
  },
  async ({ m, args, prefix }) => {
    const action = (args[0] || 'status').toLowerCase();
    const store = getStore();
    const custom = await store.get(NS.AUTOREPLY, 'message');

    if (action === 'status') {
      return m.reply(
        `🤖 Auto reply is *${(await botSettings.on('autoReply')) ? 'ON' : 'OFF'}*.\n` +
        `Message: ${custom || '_default automated-agent message_'}\n\n` +
        `Use \`${prefix}autoreply on|off\` or \`${prefix}autoreply set <message>\`.`,
      );
    }

    if (['on', 'off'].includes(action)) {
      await botSettings.set('autoReply', action === 'on');
      return m.reply(`🤖 Automated-agent replies are now *${action.toUpperCase()}* for direct messages.`);
    }

    if (action === 'set') {
      const message = args.slice(1).join(' ').trim();
      if (!message) return m.reply(`Give a message, e.g. \`${prefix}autoreply set Thanks for contacting me.\``);
      if (message.length > 500) return m.reply('Keep the automatic reply under 500 characters.');
      await store.set(NS.AUTOREPLY, 'message', message);
      return m.reply('🤖 Automatic reply message updated.');
    }

    if (action === 'reset') {
      await store.delete(NS.AUTOREPLY, 'message');
      return m.reply('🤖 Automatic reply message restored to the default.');
    }

    return m.reply(`Use \`${prefix}autoreply on|off|status|reset\` or \`${prefix}autoreply set <message>\`.`);
  },
);

/* ── bans ────────────────────────────────────────────────────────────────── */

const targetOf = (m, args) =>
  m.mentions?.[0] || m.quoted?.sender || (args[0] ? toJid(args[0]) : '');

command(
  {
    name: 'sudo',
    alias: ['setsudo'],
    category: 'owner',
    desc: 'Add, remove or list runtime sudo users',
    usage: '.sudo add 947xxxxxxxx · .sudo remove 947xxxxxxxx · .sudo list',
    ownerOnly: true,
    react: '🔐',
  },
  async ({ m, args, isOwner, number, prefix }) => {
    // `ownerOnly` normally means owner OR sudo in this bot. Access management
    // is more sensitive: only an OWNER_NUMBER from .env (or the bot itself)
    // may grant another user elevated access.
    if (!isOwner) return m.reply('🔒 Only a permanent owner can manage sudo users.');

    const action = (args[0] || 'list').toLowerCase();
    if (action === 'list') {
      const runtime = await sudoAccess.list();
      const configured = config.SUDO_NUMBERS;
      const lines = [
        '*Permanent owners (.env)*',
        ...config.OWNER_NUMBERS.map((n) => `• ${n}`),
        '',
        '*Configured sudo (.env)*',
        ...(configured.length ? configured.map((n) => `• ${n}`) : ['• none']),
        '',
        '*Runtime sudo (MongoDB)*',
        ...(runtime.length ? runtime.map((row) => `• ${row.key}`) : ['• none']),
      ];
      return m.reply(`${lines.join('\n')}\n\n${config.MENU_FOOTER}`);
    }

    if (!['add', 'remove', 'del', 'delete'].includes(action)) {
      return m.reply(`Usage:\n\`${prefix}sudo add <number>\`\n\`${prefix}sudo remove <number>\`\n\`${prefix}sudo list\``);
    }

    const jid = m.mentions?.[0] || m.quoted?.sender || (args[1] ? toJid(args[1]) : '');
    const target = digits(jid);
    if (!/^\d{8,15}$/.test(target)) {
      return m.reply('Give a valid international number, digits only, or mention/reply to the user.');
    }

    if (action === 'add') {
      if (config.OWNER_NUMBERS.includes(target)) return m.reply(`*${target}* is already a permanent owner.`);
      if (config.SUDO_NUMBERS.includes(target)) return m.reply(`*${target}* is already configured as sudo in .env.`);
      await sudoAccess.add(target, number);
      return m.reply(`🔐 Added *${target}* as sudo.\nThe change is active immediately.`);
    }

    if (config.OWNER_NUMBERS.includes(target)) return m.reply('A permanent owner cannot be removed with `.sudo`.');
    if (config.SUDO_NUMBERS.includes(target)) {
      return m.reply(`*${target}* comes from SUDO_NUMBERS in .env. Remove it there and restart.`);
    }
    const removed = await sudoAccess.remove(target);
    return m.reply(removed ? `🔓 Removed sudo access from *${target}*.` : `*${target}* was not a runtime sudo user.`);
  },
);

command(
  {
    name: 'groupsudo',
    alias: ['privategroup', 'groupaccess'],
    category: 'owner',
    desc: 'Authorize this group while the bot stays in private mode',
    usage: '.groupsudo on · .groupsudo add @user · .groupsudo list',
    ownerOnly: true,
    groupOnly: true,
    react: '👥',
  },
  async ({ m, args, isOwner, prefix, groupSettings }) => {
    // This changes the private-mode boundary, so configured/runtime sudo users
    // cannot grant access. Only an OWNER_NUMBER (or the bot itself) may do it.
    if (!isOwner) return m.reply('🔒 Only a permanent owner can manage private group access.');

    const action = (args[0] || 'status').toLowerCase();
    const members = Array.isArray(groupSettings.privateSudo) ? groupSettings.privateSudo : [];

    if (['status', 'list'].includes(action)) {
      return m.reply(
        `👥 *Private Group Access*\n\n` +
        `Access: *${groupSettings.privateAccess ? 'enabled' : 'disabled'}*\n` +
        `Group sudo:\n${members.length ? members.map((n) => `• ${n}`).join('\n') : '• none'}\n\n` +
        `Use \`${prefix}groupsudo on|off\` or \`${prefix}groupsudo add|remove @user\`.`,
      );
    }

    if (['on', 'off'].includes(action)) {
      const enabled = action === 'on';
      await groups.set(m.chat, { privateAccess: enabled });
      return m.reply(
        enabled
          ? '✅ This group can now use the bot while global mode remains *private*. Other groups are unchanged.'
          : '🔒 Private-mode access is disabled for this group.',
      );
    }

    if (!['add', 'remove', 'del', 'delete'].includes(action)) {
      return m.reply(
        `Usage:\n\`${prefix}groupsudo on\`\n\`${prefix}groupsudo off\`\n` +
        `\`${prefix}groupsudo add @user\`\n\`${prefix}groupsudo remove @user\`\n\`${prefix}groupsudo list\``,
      );
    }

    const jid = m.mentions?.[0] || m.quoted?.sender || (args[1] ? toJid(args[1]) : '');
    const target = digits(jid);
    if (!/^\d{8,15}$/.test(target)) {
      return m.reply('Mention, reply to, or provide a valid international number.');
    }

    if (action === 'add') {
      const next = [...new Set([...members, target])];
      await groups.set(m.chat, { privateAccess: true, privateSudo: next });
      return m.reply(
        `👥 Added *${target}* as sudo for this group only.\n` +
        'Private access for this group is enabled automatically.',
      );
    }

    const next = members.filter((n) => n !== target);
    await groups.set(m.chat, { privateSudo: next });
    return m.reply(
      next.length === members.length
        ? `*${target}* was not a group sudo user.`
        : `🔓 Removed *${target}* from this group's sudo list.`,
    );
  },
);

command(
  {
    name: 'nsfwdelivery',
    alias: ['nsfwupload', 'nvd'],
    category: 'owner',
    desc: 'Choose view-once or MP4 document for NSFW videos in this group',
    usage: '.nsfwdelivery viewonce · .nsfwdelivery document',
    ownerOnly: true,
    groupOnly: true,
    react: '🔞',
  },
  async ({ m, args, isOwner, prefix, groupSettings }) => {
    if (!isOwner) return m.reply('🔒 Only a permanent owner can change NSFW video delivery.');

    const choice = (args[0] || 'status').toLowerCase();
    const current = groupSettings.nsfwViewOnce === false ? 'MP4 Document' : 'View-Once Video';
    if (choice === 'status') {
      return m.reply(
        `🔞 NSFW delivery in this group: *${current}*\n\n` +
        `Use \`${prefix}nsfwdelivery viewonce\` or \`${prefix}nsfwdelivery document\`.`,
      );
    }

    const viewOnceWords = ['viewonce', 'view-once', 'on'];
    const documentWords = ['document', 'doc', 'off'];
    if (![...viewOnceWords, ...documentWords].includes(choice)) {
      return m.reply(`Choose \`viewonce\` or \`document\`. Current: *${current}*.`);
    }

    const viewOnce = viewOnceWords.includes(choice);
    await groups.set(m.chat, { nsfwViewOnce: viewOnce });
    return m.reply(
      viewOnce
        ? '🔞 NSFW videos in this group will be sent as *View-Once Video*.'
        : '📄 NSFW videos in this group will be sent as *MP4 Documents*.',
    );
  },
);

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
