import { command } from '../core/registry.js';
import { groups } from '../store/index.js';
import * as group from '../core/group.js';
import { card, truncate } from '../lib/format.js';
import { digits, toJid } from '../lib/jid.js';

/** Everyone the sender pointed at: mentions, a reply, or raw numbers. */
function targets(m, args) {
  const found = new Set(m.mentions ?? []);
  if (m.quoted?.sender) found.add(m.quoted.sender);
  for (const a of args) {
    const jid = toJid(a);
    if (jid && digits(a).length >= 8) found.add(jid);
  }
  return [...found];
}

command(
  {
    name: 'ginfo',
    alias: ['groupinfo'],
    category: 'group',
    desc: 'Show details about this group',
    groupOnly: true,
    react: 'ℹ️',
  },
  async ({ m, meta }) => {
    if (!meta) return m.reply('Could not read this group.');
    const admins = group.adminList(meta);
    return m.reply(
      card('Group', [
        ['name', meta.subject],
        ['members', String(meta.participants.length)],
        ['admins', String(admins.length)],
        ['created', meta.creation ? new Date(meta.creation * 1000).toLocaleDateString('en-GB') : '—'],
        ['locked', meta.restrict ? 'admins only' : 'open'],
        ['announce', meta.announce ? 'admins only' : 'everyone'],
        ['jid', meta.id],
      ], meta.desc ? truncate(meta.desc, 200) : ''),
    );
  },
);

command(
  {
    name: 'kick',
    alias: ['remove'],
    category: 'group',
    desc: 'Remove someone from the group',
    usage: '.kick @user',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    react: '👢',
  },
  async ({ m, sock, args, meta }) => {
    const list = targets(m, args);
    if (!list.length) return m.reply('Mention or reply to the person you want to remove.');

    const admins = group.adminList(meta);
    const protectedOnes = list.filter((jid) => admins.some((a) => digits(a) === digits(jid)));
    if (protectedOnes.length) return m.reply('🛡️ I will not remove a group admin.');

    await sock.groupParticipantsUpdate(m.chat, list, 'remove');
    group.invalidate(m.chat);
    return m.reply(`👢 Removed ${list.length} member${list.length > 1 ? 's' : ''}.`);
  },
);

command(
  {
    name: 'add',
    category: 'group',
    desc: 'Add someone to the group',
    usage: '.add 94771234567',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    react: '➕',
  },
  async ({ m, sock, args }) => {
    const list = targets(m, args);
    if (!list.length) return m.reply('Give the number(s) to add, e.g. `.add 94771234567`.');

    const result = await sock.groupParticipantsUpdate(m.chat, list, 'add');
    group.invalidate(m.chat);

    // WhatsApp reports per-number outcomes; privacy settings often block adds.
    const lines = result.map((r) => {
      const n = digits(r.jid);
      if (r.status === '200') return `✅ ${n}`;
      if (r.status === '403') return `🔒 ${n} — their privacy settings block this; send them an invite instead`;
      if (r.status === '408') return `💤 ${n} — recently left, cannot be re-added yet`;
      if (r.status === '409') return `➖ ${n} — already in the group`;
      return `❌ ${n} — failed (${r.status})`;
    });
    return m.reply(lines.join('\n'));
  },
);

command(
  {
    name: 'promote',
    category: 'group',
    desc: 'Make someone an admin',
    usage: '.promote @user',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    react: '⬆️',
  },
  async ({ m, sock, args }) => {
    const list = targets(m, args);
    if (!list.length) return m.reply('Mention or reply to the person to promote.');
    await sock.groupParticipantsUpdate(m.chat, list, 'promote');
    group.invalidate(m.chat);
    return m.reply(`⬆️ Promoted ${list.map((j) => `@${digits(j)}`).join(', ')}.`, { mentions: list });
  },
);

command(
  {
    name: 'demote',
    category: 'group',
    desc: 'Remove admin rights',
    usage: '.demote @user',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    react: '⬇️',
  },
  async ({ m, sock, args }) => {
    const list = targets(m, args);
    if (!list.length) return m.reply('Mention or reply to the person to demote.');
    await sock.groupParticipantsUpdate(m.chat, list, 'demote');
    group.invalidate(m.chat);
    return m.reply(`⬇️ Demoted ${list.map((j) => `@${digits(j)}`).join(', ')}.`, { mentions: list });
  },
);

command(
  {
    name: 'tagall',
    alias: ['everyone'],
    category: 'group',
    desc: 'Mention every member',
    usage: '.tagall [message]',
    groupOnly: true,
    adminOnly: true,
    cooldown: 30_000,
    react: '📢',
  },
  async ({ m, text, meta }) => {
    const ids = meta.participants.map((p) => p.id);
    const body = text || 'Attention everyone';
    return m.reply(
      { text: `📢 *${body}*\n\n${ids.map((j) => `• @${digits(j)}`).join('\n')}`, mentions: ids },
    );
  },
);

command(
  {
    name: 'hidetag',
    alias: ['ht'],
    category: 'group',
    desc: 'Notify everyone without showing the mentions',
    usage: '.hidetag [message]',
    groupOnly: true,
    adminOnly: true,
    cooldown: 15_000,
    react: '🔕',
  },
  async ({ m, text, meta }) => {
    const ids = meta.participants.map((p) => p.id);
    return m.send({ text: text || '📢', mentions: ids });
  },
);

command(
  {
    name: 'mute',
    category: 'group',
    desc: 'Make the bot ignore non-admins here',
    groupOnly: true,
    adminOnly: true,
    react: '🔇',
  },
  async ({ m }) => {
    await groups.set(m.chat, { mute: true });
    return m.reply('🔇 Muted — I will only answer admins in this group.');
  },
);

command(
  {
    name: 'unmute',
    category: 'group',
    desc: 'Undo .mute',
    groupOnly: true,
    adminOnly: true,
    react: '🔊',
  },
  async ({ m }) => {
    await groups.set(m.chat, { mute: false });
    return m.reply('🔊 Unmuted — everyone can use me again.');
  },
);

command(
  {
    name: 'lock',
    category: 'group',
    desc: 'Only admins may send messages',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    react: '🔒',
  },
  async ({ m, sock }) => {
    await sock.groupSettingUpdate(m.chat, 'announcement');
    return m.reply('🔒 Only admins can send messages now.');
  },
);

command(
  {
    name: 'unlock',
    category: 'group',
    desc: 'Let everyone send messages again',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    react: '🔓',
  },
  async ({ m, sock }) => {
    await sock.groupSettingUpdate(m.chat, 'not_announcement');
    return m.reply('🔓 Everyone can send messages now.');
  },
);

command(
  {
    name: 'link',
    alias: ['invite'],
    category: 'group',
    desc: 'Get the group invite link',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    react: '🔗',
  },
  async ({ m, sock, meta }) => {
    const code = await sock.groupInviteCode(m.chat);
    return m.reply(`🔗 *${meta.subject}*\nhttps://chat.whatsapp.com/${code}`);
  },
);

command(
  {
    name: 'revoke',
    category: 'group',
    desc: 'Reset the invite link',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    react: '♻️',
  },
  async ({ m, sock }) => {
    const code = await sock.groupRevokeInvite(m.chat);
    return m.reply(`♻️ Old link is dead. New link:\nhttps://chat.whatsapp.com/${code}`);
  },
);

/* ── moderation toggles ──────────────────────────────────────────────────── */

const toggle = (name, key, label, emoji) =>
  command(
    {
      name,
      category: 'group',
      desc: `Turn ${label} on or off`,
      usage: `.${name} on`,
      groupOnly: true,
      adminOnly: true,
      react: emoji,
    },
    async ({ m, args, groupSettings }) => {
      const arg = args[0]?.toLowerCase();
      if (!['on', 'off'].includes(arg)) {
        return m.reply(`${label} is currently *${groupSettings[key] ? 'on' : 'off'}*.\nUse \`.${name} on\` or \`.${name} off\`.`);
      }
      await groups.set(m.chat, { [key]: arg === 'on' });
      return m.reply(`${emoji} ${label} is now *${arg}*.`);
    },
  );

toggle('antilink', 'antilink', 'anti-link', '🔗');
toggle('antibad', 'antibad', 'the word filter', '🤬');
toggle('welcome', 'welcome', 'welcome messages', '👋');
toggle('goodbye', 'goodbye', 'goodbye messages', '👋');
toggle('nsfw', 'nsfw', 'NSFW commands', '🔞');

command(
  {
    name: 'antilinkaction',
    category: 'group',
    desc: 'What happens when someone posts a link',
    usage: '.antilinkaction kick',
    groupOnly: true,
    adminOnly: true,
    react: '⚖️',
  },
  async ({ m, args, groupSettings }) => {
    const valid = ['delete', 'warn', 'kick'];
    const next = args[0]?.toLowerCase();
    if (!valid.includes(next)) {
      return m.reply(`Choose one of: ${valid.join(', ')}\nCurrent: *${groupSettings.antilinkAction}*`);
    }
    await groups.set(m.chat, { antilinkAction: next });
    return m.reply(`⚖️ Anti-link action set to *${next}*.`);
  },
);

command(
  {
    name: 'setwelcome',
    category: 'group',
    desc: 'Set a custom welcome message',
    usage: '.setwelcome Hi {user}, welcome to {group}!',
    groupOnly: true,
    adminOnly: true,
    react: '📝',
  },
  async ({ m, text }) => {
    if (!text) return m.reply('Give the text. Placeholders: `{user}` `{group}` `{count}`');
    await groups.set(m.chat, { welcomeText: text, welcome: true });
    return m.reply('📝 Welcome message saved and enabled.');
  },
);

command(
  {
    name: 'leave',
    category: 'group',
    desc: 'Make the bot leave this group',
    groupOnly: true,
    ownerOnly: true,
    react: '👋',
  },
  async ({ m, sock }) => {
    await m.reply('👋 Leaving. Add me back any time.');
    return sock.groupLeave(m.chat);
  },
);
