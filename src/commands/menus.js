import { command, byCategory, commands, onLoaded } from '../core/registry.js';
import config from '../config.js';
import { header, hud, footer, sectionMenu, withBanner, fit, RULE } from '../lib/menu.js';

/**
 * Direct shortcuts for every section: `.groupmenu`, `.ownermenu`, and so on.
 *
 * They are registered from a post-load hook because the full category list
 * only exists once every command file has been imported. All are hidden — they
 * would otherwise double the size of the section listing they belong to.
 */
onLoaded(() => {
  for (const [name, list] of byCategory()) {
    const shortcut = `${name}menu`;
    if (commands.has(shortcut)) continue;

    command(
      {
        name: shortcut,
        category: name,
        desc: `Open the ${name} menu`,
        usage: `.${shortcut}`,
        hidden: true,
        react: '📜',
      },
      async ({ m, prefix }) =>
        withBanner(m, name, sectionMenu({ name, list: byCategory().get(name) ?? list, prefix })),
    );
  }
});

/**
 * NSFW is a permission gate, not a section — nothing currently registers a
 * command with `nsfw: true`. The menu reports that honestly rather than
 * pretending to be a category with hidden contents.
 */
command(
  {
    name: 'nsfwmenu',
    alias: ['nsfwlist'],
    category: 'group',
    desc: 'Show NSFW gate status and any gated commands',
    usage: '.nsfwmenu',
    hidden: true,
    react: '🔞',
  },
  async ({ m, prefix, groupSettings, isSudo, settings }) => {
    // NSFW commands are hidden from `.menu` on purpose, so this menu is the
    // only place they are listed — include hidden ones here.
    const gated = [...commands.values()].filter((c) => c.nsfw);

    const globalOn = Boolean(settings.adultCommands);
    const enabledHere = m.isGroup ? Boolean(groupSettings?.nsfw) : false;
    const usable = globalOn && (enabledHere || isSudo);

    const body = gated.length
      ? gated
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => `⌁ *${prefix}${c.name}*\n   ${c.desc || '—'}`)
          .join('\n\n')
      : '_No NSFW commands are installed._\n_The gate exists, but nothing is behind it._';

    const caption =
      `🔞  ${header('nsfw menu', config.BOT_NAME)}\n` +
      `${RULE}\n\n` +
      hud('gate', [
        ['installed', String(gated.length)],
        ['global', globalOn ? 'ON' : 'OFF'],
        ['this chat', m.isGroup ? (enabledHere ? 'ENABLED' : 'DISABLED') : 'DM (owner only)'],
        ['your access', usable ? (isSudo ? 'BYPASS (owner)' : 'ALLOWED') : 'BLOCKED'],
      ]) +
      `\n\n${body}\n\n${RULE}\n` +
      footer([
        !globalOn ? `\`${prefix}set adultCommands on\` — owner switch` : null,
        m.isGroup && globalOn && !enabledHere ? `\`${prefix}nsfw on\` — enable here (admins)` : null,
        `\`${prefix}menu\` — all sections`,
      ]) +
      `\n\n_Hidden from the main menu by design._`;

    return withBanner(m, 'nsfw', fit(caption, prefix));
  },
);
