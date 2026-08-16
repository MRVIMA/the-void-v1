import os from 'node:os';
import sharp from 'sharp';
import { command, commands, byCategory, resolve } from '../core/registry.js';
import config from '../config.js';
import { bytes, card, now, uptime, duration } from '../lib/format.js';
import { digits } from '../lib/jid.js';
import { saveBanner, listBanners } from '../lib/banner.js';
import { header, hud, footer, sectionMenu, icon, withBanner, RULE } from '../lib/menu.js';
import { getStore } from '../store/index.js';

/**
 * Commands a user can actually see. `commands.size` also counts hidden
 * shortcuts like `.groupmenu`, which would make the header disagree with the
 * section counts printed directly beneath it.
 */
const visibleCount = () => [...byCategory().values()].reduce((n, list) => n + list.length, 0);

/** Access requirements as short human labels. */
const flagsOf = (cmd) =>
  [
    cmd.ownerOnly && 'owner',
    cmd.adminOnly && 'admins',
    cmd.botAdmin && 'bot must be admin',
    cmd.groupOnly && 'groups only',
    cmd.privateOnly && 'DMs only',
    cmd.nsfw && 'nsfw',
    cmd.requires?.length && `needs ${cmd.requires.join(', ')}`,
  ].filter(Boolean);

/* ── the menu ────────────────────────────────────────────────────────────── */

command(
  {
    name: 'menu',
    alias: ['help', 'commands', 'list'],
    category: 'general',
    desc: 'Open the menu, a section, or one command',
    usage: '.menu · .menu download · .menu song',
    react: '📜',
  },
  async ({ m, args, prefix, settings }) => {
    const sections = byCategory();
    const query = args[0]?.toLowerCase().replace(prefix, '');

    /* a section: .menu download */
    if (query) {
      const name =
        [...sections.keys()].find((c) => c === query) ??
        [...sections.keys()].find((c) => c.startsWith(query));

      if (name) {
        return withBanner(m, name, sectionMenu({ name, list: sections.get(name), prefix }));
      }

      /* a single command: .menu song */
      const cmd = resolve(query);
      if (cmd) {
        const flags = flagsOf(cmd);
        return m.reply(
          card(`${prefix}${cmd.name}`, [
            ['section', cmd.category],
            ['usage', cmd.usage || `${prefix}${cmd.name}`],
            ['aliases', cmd.alias.length ? cmd.alias.map((a) => prefix + a).join(', ') : '—'],
            ['access', flags.length ? flags.join(', ') : 'everyone'],
            ['cooldown', cmd.cooldown ? `${Math.round(cmd.cooldown / 1000)}s` : '—'],
          ], cmd.desc) + `\n\n▚ \`${prefix}menu ${cmd.category}\` for the rest of this section`,
        );
      }

      return m.reply(
        `❔ No section or command called *${query}*.\n\n` +
          `Sections: ${[...sections.keys()].join(', ')}\n\nTry \`${prefix}menu\`.`,
      );
    }

    /* the main menu */
    // Padding sits OUTSIDE the asterisks: WhatsApp will not bold a run that
    // ends in a space, and renders the markers literally instead.
    const sectionLines = [...sections.entries()]
      .map(([name, list]) => {
        const pad = ' '.repeat(Math.max(1, 10 - name.length));
        return `│ ${icon(name)} *${name}*${pad}${String(list.length).padStart(2)}`;
      })
      .join('\n');

    const caption =
      `${header(config.BOT_NAME, config.MENU_TAGLINE)}\n\n` +
      hud('system', [
        ['user', m.pushName || 'unknown'],
        ['mode', settings.mode],
        ['prefix', prefix],
        ['uptime', uptime()],
        ['commands', String(visibleCount())],
      ]) +
      `\n\n╭─ *SECTIONS*\n${sectionLines}\n╰${RULE}\n\n` +
      footer([
        `\`${prefix}menu <section>\` — open a section`,
        `\`${prefix}menu <command>\` — command details`,
        `\`${prefix}system\` — host and runtime info`,
      ]);

    return withBanner(m, 'menu', caption);
  },
);

/* ── alive ───────────────────────────────────────────────────────────────── */

command(
  {
    name: 'alive',
    alias: ['status', 'uptime'],
    category: 'general',
    desc: 'Confirm the bot is running',
    react: '💫',
  },
  async ({ m, sock }) => {
    // SIGNAL is a real measurement, not decoration: how long a round-trip to
    // the datastore actually takes right now.
    const t0 = Date.now();
    let latency = null;
    try {
      const store = getStore();
      await store.set('state', '__alive', Date.now());
      latency = Date.now() - t0;
    } catch {
      /* store unreachable — reported as UNKNOWN below */
    }

    const signal =
      latency === null ? 'UNKNOWN' : latency < 150 ? 'STRONG' : latency < 500 ? 'GOOD' : 'WEAK';

    const caption =
      `${header('alive', 'THE VØID IS ACTIVE.')}\n\n` +
      hud('status', [
        ['status', 'ONLINE'],
        ['protocol', 'ACTIVE'],
        ['signal', latency === null ? signal : `${signal} (${latency}ms)`],
        ['uptime', uptime()],
        ['commands', String(visibleCount())],
        ['number', digits(sock.user?.id)],
      ]) +
      `\n\n> YOU CALL.  I RESPOND.  WE DOMINATE.`;

    return withBanner(m, 'alive', caption);
  },
);

/* ── system info ─────────────────────────────────────────────────────────── */

command(
  {
    name: 'system',
    alias: ['sysinfo', 'server', 'host'],
    category: 'general',
    desc: 'Host, runtime and resource usage',
    react: '🖥️',
  },
  async ({ m }) => {
    const mem = process.memoryUsage();
    const usedSys = os.totalmem() - os.freemem();
    const cpu = os.cpus();

    let store = 'unavailable';
    try {
      store = getStore().driver;
    } catch {
      /* not initialised */
    }

    const { date, time } = now();

    const caption =
      `${header('system info', `${config.BOT_NAME} · host diagnostics`)}\n\n` +
      hud('runtime', [
        ['node', process.versions.node],
        ['platform', `${process.platform}/${process.arch}`],
        ['process', duration(process.uptime())],
        ['heap', `${bytes(mem.heapUsed)} / ${bytes(mem.heapTotal)}`],
        ['rss', bytes(mem.rss)],
      ]) +
      `\n\n` +
      hud('host', [
        ['cpu', `${cpu[0]?.model?.trim().slice(0, 22) ?? 'unknown'}`],
        ['cores', String(cpu.length)],
        ['memory', `${bytes(usedSys)} / ${bytes(os.totalmem())}`],
        ['load', os.loadavg().map((n) => n.toFixed(2)).join(' ')],
        ['boot', duration(os.uptime())],
      ]) +
      `\n\n` +
      hud('bot', [
        ['store', store],
        ['commands', `${visibleCount()} (+${commands.size - visibleCount()} hidden)`],
        ['sections', String(byCategory().size)],
        ['timezone', config.TIMEZONE],
        ['clock', `${date} ${time}`],
      ]);

    return withBanner(m, 'system', caption);
  },
);

/* ── small utilities ─────────────────────────────────────────────────────── */

command(
  {
    name: 'ping',
    category: 'general',
    desc: 'Measure the bot round-trip time',
    react: '🏓',
  },
  async ({ m }) => {
    const started = Date.now();
    const sent = await m.reply('◈ Pinging the void…');
    return m.send({ text: `🏓 *PONG* — ${Date.now() - started} ms`, edit: sent.key });
  },
);

command(
  {
    name: 'jid',
    alias: ['id', 'chatid'],
    category: 'general',
    desc: 'Show the JID of this chat, or of a quoted user',
    react: '🆔',
  },
  async ({ m }) => {
    const rows = [['chat', m.chat]];
    if (m.isGroup) rows.push(['you', m.sender]);
    if (m.quoted) rows.push(['quoted', m.quoted.sender || '—']);
    return m.reply(card('JID', rows));
  },
);

command(
  {
    name: 'owner',
    alias: ['creator'],
    category: 'general',
    desc: "Send the owner's contact card",
    react: '👤',
  },
  async ({ m, sock }) => {
    const number = config.OWNER_NUMBERS[0];
    if (!number) return m.reply('No owner number is configured.');

    return sock.sendMessage(
      m.chat,
      {
        contacts: {
          displayName: config.OWNER_NAME,
          contacts: [
            {
              vcard: [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${config.OWNER_NAME}`,
                `TEL;type=CELL;type=VOICE;waid=${number}:+${number}`,
                'END:VCARD',
              ].join('\n'),
            },
          ],
        },
      },
      { quoted: m.raw },
    );
  },
);

/* ── banner management ───────────────────────────────────────────────────── */

command(
  {
    name: 'setbanner',
    category: 'general',
    desc: 'Set a menu banner — reply to an image',
    usage: '.setbanner [menu|alive|system|owner|group|nsfw|settings]',
    ownerOnly: true,
    react: '🖼️',
  },
  async ({ m, args, prefix }) => {
    const name = (args[0] || 'menu').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!name) return m.reply('Give a valid banner name, e.g. `.setbanner alive`');

    const target = m.quoted?.type === 'imageMessage' ? m.quoted : m.type === 'imageMessage' ? m : null;
    if (!target) {
      const have = await listBanners();
      return m.reply(
        `Reply to an image with \`${prefix}setbanner <name>\`.\n\n` +
          `*On disk:* ${have.length ? have.join(', ') : 'none yet'}\n` +
          `*Used by menus:* menu, alive, system, owner, group, nsfw, settings\n\n` +
          `_Any menu without its own art falls back to *banner*._`,
      );
    }

    const buffer = await target.download();
    if (!buffer?.length) return m.reply('That image came back empty — send it again.');

    // Normalised to PNG so whatever arrives is stored in one predictable format.
    const png = await sharp(buffer).png().toBuffer();
    await saveBanner(name, png);

    return m.reply(`🖼️ Banner *${name}* saved — ${bytes(png.length)}.\nSend \`${prefix}${name === 'menu' ? 'menu' : name}\` to see it.`);
  },
);
