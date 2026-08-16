import config from '../config.js';

/* ── time ────────────────────────────────────────────────────────────────── */

/** Current date/time in the configured zone, without pulling in moment. */
export function now(tz = config.TIMEZONE) {
  const d = new Date();
  return {
    date: d.toLocaleDateString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    day: d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'long' }),
    iso: d.toISOString(),
  };
}

/** `93820` -> `1d 2h 3m 40s` */
export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const parts = [
    [Math.floor(s / 86400), 'd'],
    [Math.floor((s % 86400) / 3600), 'h'],
    [Math.floor((s % 3600) / 60), 'm'],
    [s % 60, 's'],
  ].filter(([v], i) => v > 0 || i === 3);
  return parts.map(([v, u]) => `${v}${u}`).join(' ');
}

export const uptime = () => duration(process.uptime());

/* ── size & numbers ──────────────────────────────────────────────────────── */

export function bytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** `1234567` -> `1.2M` */
export function compact(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n ?? '');
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
}

/* ── text ────────────────────────────────────────────────────────────────── */

export const truncate = (text = '', max = 200) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Strips characters WhatsApp renders badly in monospace blocks. */
export const clean = (text = '') => String(text).replace(/‎|‏| /g, ' ').trim();

export const mono = (text) => '```' + String(text).replace(/`/g, "'") + '```';
export const bold = (text) => `*${text}*`;
export const italic = (text) => `_${text}_`;

/**
 * Renders a labelled block used by menus and info cards:
 *   ╭─ Title
 *   │ key : value
 *   ╰────────────
 */
export function card(title, rows, footer) {
  const width = Math.max(...rows.map(([k]) => k.length), 0);
  const body = rows.map(([k, v]) => `│ ${k.padEnd(width)} : ${v}`).join('\n');
  return [`╭─ *${title}*`, body, '╰────────────────', footer ? `\n${footer}` : ''].filter(Boolean).join('\n');
}

/** Substitutes `{name}` placeholders in user-authored templates. */
export function template(text = '', vars = {}) {
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key] ?? '') : match));
}

/** Human-readable phone number for mentions: `94771234567` -> `@94771234567`. */
export const mention = (jid = '') => `@${String(jid).split('@')[0].split(':')[0]}`;

export default { now, duration, uptime, bytes, compact, truncate, clean, mono, bold, italic, card, template, mention };
