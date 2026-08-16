import { evaluate } from 'mathjs';
import ytSearch from 'yt-search';
import { command } from '../core/registry.js';
import config from '../config.js';
import { getJson } from '../lib/http.js';
import { card, compact, truncate } from '../lib/format.js';

command(
  {
    name: 'weather',
    category: 'utility',
    desc: 'Current weather for a place',
    usage: '.weather Colombo',
    requires: ['OPENWEATHER_API_KEY'],
    react: '🌦️',
    cooldown: 4000,
  },
  async ({ m, text }) => {
    if (!text) return m.reply('Which place? e.g. `.weather Colombo`');

    const data = await getJson('https://api.openweathermap.org/data/2.5/weather', {
      params: { q: text, appid: config.OPENWEATHER_API_KEY, units: 'metric' },
    });

    if (String(data.cod) !== '200') return m.reply(`🌍 I could not find *${text}*.`);

    return m.reply(
      card(`${data.name}, ${data.sys?.country ?? ''}`.trim(), [
        ['now', `${Math.round(data.main.temp)}°C — ${data.weather?.[0]?.description ?? ''}`],
        ['feels', `${Math.round(data.main.feels_like)}°C`],
        ['range', `${Math.round(data.main.temp_min)}° / ${Math.round(data.main.temp_max)}°`],
        ['humidity', `${data.main.humidity}%`],
        ['wind', `${data.wind?.speed ?? 0} m/s`],
        ['clouds', `${data.clouds?.all ?? 0}%`],
      ]),
    );
  },
);

command(
  {
    name: 'yts',
    alias: ['ytsearch'],
    category: 'utility',
    desc: 'Search YouTube and show the top results',
    usage: '.yts lofi beats',
    react: '🔎',
    cooldown: 5000,
  },
  async ({ m, text }) => {
    if (!text) return m.reply('What should I search for? e.g. `.yts lofi beats`');

    const { videos } = await ytSearch(text);
    if (!videos?.length) return m.reply(`🔎 No results for *${text}*.`);

    const top = videos.slice(0, 6);
    const body = top
      .map(
        (v, i) =>
          `*${i + 1}.* ${truncate(v.title, 60)}\n` +
          `   ⏱ ${v.timestamp} · 👁 ${compact(v.views)} · ${v.author.name}\n` +
          `   ${v.url}`,
      )
      .join('\n\n');

    return m.reply({
      image: { url: top[0].thumbnail },
      caption: `🔎 *Results for "${text}"*\n\n${body}`,
    });
  },
);

command(
  {
    name: 'calc',
    alias: ['math'],
    category: 'utility',
    desc: 'Evaluate a maths expression',
    usage: '.calc (12 * 3) / 4 + sqrt(16)',
    react: '🧮',
  },
  async ({ m, text }) => {
    if (!text) return m.reply('Give me an expression, e.g. `.calc 2^10 + 5`');
    try {
      // mathjs `evaluate` is sandboxed — it parses maths, it does not run JS.
      const result = evaluate(text);
      return m.reply(`🧮 \`${text}\` = *${result}*`);
    } catch {
      return m.reply('🧮 I could not parse that expression.');
    }
  },
);

command(
  {
    name: 'define',
    alias: ['dict'],
    category: 'utility',
    desc: 'Dictionary definition of a word',
    usage: '.define serendipity',
    react: '📖',
    cooldown: 3000,
  },
  async ({ m, text }) => {
    if (!text) return m.reply('Which word? e.g. `.define serendipity`');

    const data = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text.split(/\s+/)[0])}`);
    if (!Array.isArray(data) || !data.length) return m.reply(`📖 No entry for *${text}*.`);

    const entry = data[0];
    const lines = [`📖 *${entry.word}* ${entry.phonetic ?? ''}`.trim(), ''];
    for (const meaning of entry.meanings.slice(0, 3)) {
      lines.push(`_${meaning.partOfSpeech}_`);
      for (const def of meaning.definitions.slice(0, 2)) {
        lines.push(`• ${def.definition}`);
        if (def.example) lines.push(`  _"${def.example}"_`);
      }
      lines.push('');
    }
    return m.reply(lines.join('\n').trim());
  },
);
