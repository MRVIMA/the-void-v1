import { command } from '../core/registry.js';
import config from '../config.js';
import { getBuffer, getJson, postJson } from '../lib/http.js';
import { card, compact, truncate } from '../lib/format.js';

/* ── TMDB ────────────────────────────────────────────────────────────────── */

const tmdb = (path, params = {}) =>
  getJson(`https://api.themoviedb.org/3${path}`, {
    params: { api_key: config.TMDB_API_KEY, include_adult: false, ...params },
  });

const poster = (p) => (p ? `https://image.tmdb.org/t/p/w500${p}` : null);

/** `169` -> `2h 49m` */
const runtime = (mins) => {
  if (!mins) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

const money = (n) => (n ? `$${compact(n)}` : '—');

command(
  {
    name: 'movie',
    alias: ['film', 'tmdb'],
    category: 'movie',
    desc: 'Full details for a film',
    usage: '.movie Interstellar',
    requires: ['TMDB_API_KEY'],
    react: '🎬',
    cooldown: 4000,
  },
  async ({ m, text }) => {
    if (!text) return m.reply('Which film? e.g. `.movie Interstellar`');

    const search = await tmdb('/search/movie', { query: text });
    const hit = search.results?.[0];
    if (!hit) return m.reply(`🎬 No film found for *${text}*.`);

    // One extra call gets genres, runtime and credits in a single response.
    const full = await tmdb(`/movie/${hit.id}`, { append_to_response: 'credits' });

    const director = full.credits?.crew?.find((c) => c.job === 'Director')?.name;
    const cast = (full.credits?.cast ?? []).slice(0, 5).map((c) => c.name).join(', ');

    const caption = card(
      `${full.title} (${(full.release_date ?? '').slice(0, 4) || '—'})`,
      [
        ['rating', full.vote_average ? `⭐ ${full.vote_average.toFixed(1)}/10 (${compact(full.vote_count)})` : '—'],
        ['runtime', runtime(full.runtime)],
        ['genres', full.genres?.map((g) => g.name).join(', ') || '—'],
        ['released', full.release_date || '—'],
        ['director', director || '—'],
        ['budget', money(full.budget)],
        ['revenue', money(full.revenue)],
      ],
      `${truncate(full.overview || 'No synopsis available.', 450)}${cast ? `\n\n*Starring:* ${cast}` : ''}`,
    );

    const image = poster(full.poster_path);
    return image ? m.reply({ image: { url: image }, caption }) : m.reply(caption);
  },
);

command(
  {
    name: 'tv',
    alias: ['series', 'show'],
    category: 'movie',
    desc: 'Details for a TV series, including seasons',
    usage: '.tv Breaking Bad',
    requires: ['TMDB_API_KEY'],
    react: '📺',
    cooldown: 4000,
  },
  async ({ m, text }) => {
    if (!text) return m.reply('Which series? e.g. `.tv Breaking Bad`');

    const search = await tmdb('/search/tv', { query: text });
    const hit = search.results?.[0];
    if (!hit) return m.reply(`📺 No series found for *${text}*.`);

    const full = await tmdb(`/tv/${hit.id}`);

    const seasons = (full.seasons ?? [])
      .filter((s) => s.season_number > 0)
      .map((s) => `  S${String(s.season_number).padStart(2, '0')} — ${s.episode_count} eps${s.air_date ? ` (${s.air_date.slice(0, 4)})` : ''}`)
      .join('\n');

    const caption = card(
      `${full.name} (${(full.first_air_date ?? '').slice(0, 4) || '—'})`,
      [
        ['rating', full.vote_average ? `⭐ ${full.vote_average.toFixed(1)}/10 (${compact(full.vote_count)})` : '—'],
        ['status', full.status || '—'],
        ['seasons', String(full.number_of_seasons ?? '—')],
        ['episodes', String(full.number_of_episodes ?? '—')],
        ['genres', full.genres?.map((g) => g.name).join(', ') || '—'],
        ['network', full.networks?.[0]?.name || '—'],
      ],
      `${truncate(full.overview || 'No synopsis available.', 350)}${seasons ? `\n\n*Seasons:*\n${seasons}` : ''}`,
    );

    const image = poster(full.poster_path);
    return image ? m.reply({ image: { url: image }, caption }) : m.reply(caption);
  },
);

command(
  {
    name: 'trending',
    category: 'movie',
    desc: 'What is trending this week',
    usage: '.trending [movie|tv]',
    requires: ['TMDB_API_KEY'],
    react: '🔥',
    cooldown: 6000,
  },
  async ({ m, args }) => {
    const kind = ['movie', 'tv'].includes(args[0]?.toLowerCase()) ? args[0].toLowerCase() : 'all';
    const data = await tmdb(`/trending/${kind}/week`);

    const list = (data.results ?? []).slice(0, 10);
    if (!list.length) return m.reply('Nothing trending right now.');

    const body = list
      .map((r, i) => {
        const title = r.title ?? r.name;
        const year = (r.release_date ?? r.first_air_date ?? '').slice(0, 4);
        const star = r.vote_average ? ` ⭐${r.vote_average.toFixed(1)}` : '';
        return `*${i + 1}.* ${truncate(title, 45)}${year ? ` (${year})` : ''}${star}`;
      })
      .join('\n');

    const image = poster(list[0].poster_path);
    const caption = `🔥 *Trending ${kind === 'all' ? 'this week' : kind}*\n\n${body}`;
    return image ? m.reply({ image: { url: image }, caption }) : m.reply(caption);
  },
);

command(
  {
    name: 'cast',
    category: 'movie',
    desc: 'Billed cast for a film',
    usage: '.cast The Matrix',
    requires: ['TMDB_API_KEY'],
    react: '🎭',
    cooldown: 4000,
  },
  async ({ m, text }) => {
    if (!text) return m.reply('Which film? e.g. `.cast The Matrix`');

    const search = await tmdb('/search/movie', { query: text });
    const hit = search.results?.[0];
    if (!hit) return m.reply(`🎭 No film found for *${text}*.`);

    const credits = await tmdb(`/movie/${hit.id}/credits`);
    const cast = (credits.cast ?? []).slice(0, 12);
    if (!cast.length) return m.reply('No cast listed for that one.');

    const body = cast.map((c) => `• *${c.name}* as ${c.character || '—'}`).join('\n');
    return m.reply(`🎭 *${hit.title}*\n\n${body}`);
  },
);

command(
  {
    name: 'imdb',
    alias: ['omdb', 'ratings'],
    category: 'movie',
    desc: 'IMDb, Rotten Tomatoes and Metacritic scores',
    usage: '.imdb Inception',
    requires: ['OMDB_API_KEY'],
    react: '⭐',
    cooldown: 4000,
  },
  async ({ m, text }) => {
    if (!text) return m.reply('Which title? e.g. `.imdb Inception`');

    const data = await getJson('https://www.omdbapi.com/', {
      params: { apikey: config.OMDB_API_KEY, t: text, plot: 'short' },
    });

    if (data.Response === 'False') return m.reply(`⭐ ${data.Error ?? 'Not found'}.`);

    const scores = (data.Ratings ?? []).map((r) => [r.Source.replace('Internet Movie Database', 'IMDb'), r.Value]);

    const caption = card(
      `${data.Title} (${data.Year})`,
      [
        ...scores,
        ['metascore', data.Metascore && data.Metascore !== 'N/A' ? `${data.Metascore}/100` : '—'],
        ['rated', data.Rated || '—'],
        ['runtime', data.Runtime || '—'],
        ['genre', data.Genre || '—'],
        ['director', data.Director || '—'],
      ],
      truncate(data.Plot || '', 350),
    );

    return data.Poster && data.Poster !== 'N/A'
      ? m.reply({ image: { url: data.Poster }, caption })
      : m.reply(caption);
  },
);

/* ── subtitles (OpenSubtitles) ───────────────────────────────────────────── */

/**
 * OpenSubtitles is the licensed, documented way to fetch subtitles — a public
 * REST API with a free tier, rather than scraping a file-locker site.
 * Get a key at https://www.opensubtitles.com/consumers
 */
const OS_BASE = 'https://api.opensubtitles.com/api/v1';

const osHeaders = () => ({
  'Api-Key': config.OPENSUBTITLES_API_KEY,
  'User-Agent': `${config.BOT_NAME} v2.0`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

command(
  {
    name: 'sub',
    alias: ['subtitle', 'subsearch'],
    category: 'movie',
    desc: 'Search for subtitles',
    usage: '.sub Interstellar   ·   .sub si Interstellar',
    requires: ['OPENSUBTITLES_API_KEY'],
    react: '💬',
    cooldown: 6000,
  },
  async ({ m, args, prefix }) => {
    if (!args.length) return m.reply(`Which title? e.g. \`${prefix}sub Interstellar\``);

    // An optional 2-letter language code may lead the query: `.sub si Movie`
    let languages = config.SUBTITLE_LANGS;
    let query = args.join(' ');
    if (/^[a-z]{2}$/i.test(args[0]) && args.length > 1) {
      languages = args[0].toLowerCase();
      query = args.slice(1).join(' ');
    }

    const data = await getJson(`${OS_BASE}/subtitles`, {
      headers: osHeaders(),
      params: { query, languages, order_by: 'download_count' },
    });

    // A result with no attached file cannot be downloaded, so never list one.
    const hits = (data.data ?? []).filter((s) => s.attributes?.files?.[0]?.file_id).slice(0, 6);
    if (!hits.length) return m.reply(`💬 No *${languages}* subtitles found for *${query}*.`);

    const body = hits
      .map((s, i) => {
        const a = s.attributes;
        const fileId = a.files[0].file_id;
        return (
          `*${i + 1}.* ${truncate(a.release || a.feature_details?.title || 'Untitled', 55)}\n` +
          `   🌐 ${a.language} · ⬇ ${compact(a.download_count)}${a.hearing_impaired ? ' · HI' : ''}\n` +
          `   \`${prefix}subget ${fileId}\``
        );
      })
      .join('\n\n');

    return m.reply(`💬 *Subtitles for "${query}"*\n\n${body}\n\n_Send the command under a result to download it._`);
  },
);

command(
  {
    name: 'subget',
    alias: ['subdl'],
    category: 'movie',
    desc: 'Download a subtitle file by its id',
    usage: '.subget 1234567',
    requires: ['OPENSUBTITLES_API_KEY'],
    react: '⬇️',
    cooldown: 8000,
  },
  async ({ m, args, prefix }) => {
    const fileId = Number(args[0]);
    if (!Number.isFinite(fileId)) {
      return m.reply(`Give the id from a \`${prefix}sub\` result, e.g. \`${prefix}subget 1234567\``);
    }

    let info;
    try {
      info = await postJson(`${OS_BASE}/download`, { file_id: fileId }, { headers: osHeaders() });
    } catch (err) {
      // The free tier allows a limited number of downloads per day.
      if (/40[36]/.test(err.message)) {
        return m.reply('⬇️ The OpenSubtitles download quota for today is used up. It resets every 24 hours.');
      }
      throw err;
    }

    if (!info?.link) return m.reply('⬇️ That subtitle could not be fetched — try another result.');

    const buffer = await getBuffer(info.link);
    const fileName = info.file_name?.endsWith('.srt') ? info.file_name : `${info.file_name ?? 'subtitle'}.srt`;

    return m.reply({
      document: buffer,
      fileName,
      mimetype: 'application/x-subrip',
      caption: `💬 ${fileName}${info.remaining != null ? `\n_${info.remaining} downloads left today._` : ''}`,
    });
  },
);
