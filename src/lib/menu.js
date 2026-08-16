import config from '../config.js';
import { banner } from './banner.js';
import { log } from './logger.js';

const logger = log('menu');

/**
 * Shared menu chrome.
 *
 * Every menu is one message, and when a banner is attached that message is an
 * image caption — which WhatsApp truncates at roughly 1024 characters. So the
 * layouts here are deliberately compact: section views list command names
 * only, and descriptions live behind `.menu <command>`. A menu that silently
 * loses its last five entries is worse than one that never showed them.
 */

export const CAPTION_LIMIT = 1024;

export const RULE = '━━━━━━━━━━━━━━━━━';
export const BULLET = '⌁';

/** Section glyphs — plain emoji, so they render on every device. */
const ICON = {
  ai: '🤖',
  audio: '🎚️',
  download: '⏬',
  general: '📜',
  group: '👥',
  image: '🎨',
  movie: '🎬',
  nsfw: '🔞',
  owner: '🔑',
  settings: '⚙️',
  system: '🖥️',
  tools: '🛠️',
  utility: '🧰',
};

export const icon = (name) => ICON[name] ?? '▪';

/** `▚▚▚ *TITLE* ▚▚▚` with an optional italic subtitle. */
export function header(title, subtitle) {
  return `▚▚▚  *${title.toUpperCase()}*  ▚▚▚` + (subtitle ? `\n_${subtitle}_` : '');
}

/**
 * HUD-style key/value block:
 *   ╭─ SYSTEM
 *   │ STATUS   : ONLINE
 *   ╰━━━━━━━━━
 */
export function hud(title, rows) {
  const width = Math.max(...rows.map(([k]) => k.length));
  const body = rows.map(([k, v]) => `│ ${k.toUpperCase().padEnd(width)} : ${v}`).join('\n');
  return `╭─ *${title.toUpperCase()}*\n${body}\n╰${RULE}`;
}

/** Footer links shown under every menu. */
export function footer(lines) {
  return lines.filter(Boolean).map((l) => `▚ ${l}`).join('\n');
}

/**
 * A section listing. Names only — see the note at the top of this file.
 * Access-restricted commands are flagged so the reader knows before trying.
 */
const flagOf = (c) => (c.ownerOnly ? '🔑' : c.adminOnly ? '🛡️' : c.requires?.length ? '🔧' : '');

export function sectionBody(list, prefix, { showFlags = true } = {}) {
  if (!list.length) return '_No commands in this section._';
  return list
    .map((c) => {
      const flag = showFlags ? flagOf(c) : '';
      return `${BULLET} *${prefix}${c.name}*${flag ? ` ${flag}` : ''}`;
    })
    .join('\n');
}

/** Assembles a complete section menu and guarantees it fits in a caption. */
export function sectionMenu({ name, list, prefix, subtitle }) {
  // When every command in a section carries the same restriction, a marker on
  // each line is noise — state it once in the subtitle instead.
  const flags = list.map(flagOf);
  const uniform = list.length > 1 && flags.every((f) => f && f === flags[0]);
  const uniformLabel = { '🔑': 'owner only', '🛡️': 'admins only', '🔧': 'needs an API key' }[flags[0]];

  const count = `${list.length} command${list.length === 1 ? '' : 's'}`;
  const sub = subtitle ?? `${count}${uniform ? ` · ${uniformLabel}` : ''} · ${config.BOT_NAME}`;

  const legend = uniform || !flags.some(Boolean) ? '' : '\n\n🔑 owner · 🛡️ admin · 🔧 needs an API key';

  const text =
    `${icon(name)}  ${header(`${name} menu`, sub)}\n` +
    `${RULE}\n\n` +
    `${sectionBody(list, prefix, { showFlags: !uniform })}\n\n` +
    `${RULE}\n` +
    footer([`\`${prefix}menu <command>\` — details`, `\`${prefix}menu\` — all sections`]) +
    legend;

  return fit(text, prefix);
}

/**
 * Last-resort guard. If a section ever grows past the caption limit, drop the
 * legend rather than let WhatsApp truncate the command list itself.
 */
export function fit(text, prefix) {
  if (text.length <= CAPTION_LIMIT) return text;
  const trimmed = text.replace(/\n\n🔑 owner · 🛡️ admin · 🔧 needs an API key$/, '');
  /* c8 ignore next -- only reached by sections far larger than any today */
  if (trimmed.length <= CAPTION_LIMIT) return trimmed;
  return `${trimmed.slice(0, CAPTION_LIMIT - 60).trimEnd()}\n…\n▚ \`${prefix}menu\``;
}

/**
 * Sends a menu with its banner attached, or as plain text when the artwork is
 * missing. Every menu goes through here so the fallback behaviour is identical
 * across all of them.
 */
export async function withBanner(m, name, caption) {
  const credit = config.MENU_FOOTER?.trim();
  const brandedCaption = credit && !caption.trimEnd().endsWith(credit)
    ? `${caption.trimEnd()}\n\n${credit}`
    : caption;
  const image = await banner(name);
  if (!image) return m.reply(brandedCaption);

  try {
    return await m.reply({ image, caption: brandedCaption });
  } catch (err) {
    // WhatsApp's media hosts occasionally reject every upload endpoint even
    // while ordinary messages still work. A menu must not disappear merely
    // because its decorative banner could not be uploaded.
    logger.warn({ name, err: err.message }, 'banner upload failed — retrying menu as text');
    return m.reply(brandedCaption);
  }
}

export default {
  header, hud, footer, sectionMenu, sectionBody, icon, fit, withBanner,
  RULE, BULLET, CAPTION_LIMIT,
};
