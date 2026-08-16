import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SRC } from '../config.js';
import { log } from '../lib/logger.js';

const logger = log('registry');

/** name -> definition */
export const commands = new Map();
/** alias -> canonical name */
export const aliases = new Map();

/**
 * Registers a command.
 *
 * Every field is optional except `name` and the handler. The gate fields are
 * enforced centrally in the handler, so a command body can assume it only ever
 * runs when its preconditions already hold.
 *
 * @param {object} def
 * @param {string}   def.name         primary invocation, without prefix
 * @param {string[]} [def.alias]      alternative names
 * @param {string}   [def.category]   grouping shown in the menu
 * @param {string}   [def.desc]       one-line description
 * @param {string}   [def.usage]      example, e.g. `.kick @user`
 * @param {string}   [def.react]      emoji reacted to the invoking message
 * @param {boolean}  [def.ownerOnly]  owner or sudo only
 * @param {boolean}  [def.groupOnly]  must be used inside a group
 * @param {boolean}  [def.privateOnly] must be used in a DM
 * @param {boolean}  [def.adminOnly]  sender must be a group admin
 * @param {boolean}  [def.botAdmin]   bot must be a group admin
 * @param {boolean}  [def.nsfw]       requires the group's nsfw flag
 * @param {string[]} [def.requires]   config keys that must be present
 * @param {number}   [def.cooldown]   per-user cooldown in ms
 * @param {boolean}  [def.hidden]     kept out of the menu
 * @param {Function} handler          async ({ sock, m, args, ... }) => any
 */
export function command(def, handler) {
  if (!def?.name) throw new Error('command() requires a name');
  if (typeof handler !== 'function') throw new Error(`command "${def.name}" has no handler`);

  const name = def.name.toLowerCase();
  if (commands.has(name)) logger.warn({ name }, 'duplicate command name — overwriting');

  const entry = {
    category: 'misc',
    desc: '',
    usage: '',
    alias: [],
    requires: [],
    cooldown: 0,
    ownerOnly: false,
    groupOnly: false,
    privateOnly: false,
    adminOnly: false,
    botAdmin: false,
    nsfw: false,
    hidden: false,
    ...def,
    name,
    handler,
  };

  commands.set(name, entry);
  for (const a of entry.alias) {
    const key = String(a).toLowerCase();
    if (aliases.has(key) && aliases.get(key) !== name) {
      logger.warn({ alias: key, name }, 'duplicate alias — overwriting');
    }
    aliases.set(key, name);
  }
  return entry;
}

/**
 * Callbacks run once every command module has been imported.
 *
 * A module that wants to register commands derived from the full command list
 * cannot do it at import time — files load alphabetically, so half the
 * categories do not exist yet. Registering here instead of renaming files to
 * force load order keeps the dependency explicit.
 */
const postLoadHooks = [];
export const onLoaded = (fn) => postLoadHooks.push(fn);

/** Resolves a typed word to a command definition, following aliases. */
export function resolve(word = '') {
  const key = String(word).toLowerCase();
  return commands.get(key) ?? commands.get(aliases.get(key)) ?? null;
}

/** Commands grouped by category, alphabetised, hidden ones removed. */
export function byCategory({ includeHidden = false } = {}) {
  const out = new Map();
  for (const cmd of commands.values()) {
    if (cmd.hidden && !includeHidden) continue;
    if (!out.has(cmd.category)) out.set(cmd.category, []);
    out.get(cmd.category).push(cmd);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Imports every module in src/commands. A module that throws is skipped with a
 * logged reason rather than taking the whole bot down — one broken command
 * should never prevent the bot from starting.
 */
export async function loadCommands() {
  const dir = path.join(SRC, 'commands');
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.js'));
  } catch {
    logger.warn({ dir }, 'no commands directory found');
    return { loaded: 0, failed: 0 };
  }

  let failed = 0;
  for (const file of files.sort()) {
    try {
      // Cache-busted so a future `.reload` can re-import without a restart.
      await import(`${pathToFileURL(path.join(dir, file)).href}?v=${Date.now()}`);
    } catch (err) {
      failed++;
      logger.error({ file, err: err.message }, 'failed to load command module');
    }
  }

  for (const hook of postLoadHooks) {
    try {
      await hook();
    } catch (err) {
      logger.error({ err: err.message }, 'post-load hook failed');
    }
  }

  logger.info({ commands: commands.size, files: files.length, failed }, 'commands loaded');
  return { loaded: commands.size, failed };
}

export default { command, commands, aliases, resolve, byCategory, loadCommands };
