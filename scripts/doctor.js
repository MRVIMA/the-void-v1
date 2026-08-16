#!/usr/bin/env node
import dns from 'node:dns/promises';
import net from 'node:net';
import config from '../src/config.js';

/**
 * Connection diagnostics.
 *
 * MongoDB failures all surface as the same unhelpful "falling back to local
 * SQLite" line, but the causes are very different: blocked SRV lookups, a
 * firewall, an IP that is not allowlisted, or bad credentials. This walks the
 * layers in order and names the one that broke.
 */

const ok = (label, detail = '') => console.log(`  \x1b[32mok\x1b[0m    ${label.padEnd(38)} ${detail}`);
const bad = (label, detail = '') => console.log(`  \x1b[31mFAIL\x1b[0m  ${label.padEnd(38)} ${detail}`);
const info = (label, detail = '') => console.log(`  ·     ${label.padEnd(38)} ${detail}`);

const problems = [];

console.log('\nTHE VØID — connection doctor\n');

/* ── 1. public IP ───────────────────────────────────────────────────────── */

console.log('1 — network identity');
let publicIp = null;
try {
  const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10_000) });
  publicIp = (await res.json()).ip;
  info('public IP', publicIp);
} catch {
  info('public IP', 'could not determine');
}

/* ── 2. MongoDB ─────────────────────────────────────────────────────────── */

console.log('\n2 — MongoDB');

if (!config.MONGO_URI) {
  info('MONGO_URI', 'not set — using local SQLite by design');
} else {
  const isSrv = config.MONGO_URI.startsWith('mongodb+srv://');
  const hostPart = config.MONGO_URI.replace(/^mongodb(\+srv)?:\/\//, '').split('@').pop().split('/')[0];
  const firstHost = hostPart.split(',')[0].split(':')[0];
  info('URI form', isSrv ? 'mongodb+srv:// (SRV lookup)' : 'mongodb:// (direct hosts)');

  // DNS
  if (isSrv) {
    try {
      const recs = await dns.resolveSrv(`_mongodb._tcp.${firstHost}`);
      ok('SRV record', `${recs.length} shards`);
    } catch (err) {
      bad('SRV record', err.code ?? err.message);
      problems.push(
        'The SRV lookup failed. Some networks block it. Switch MONGO_URI to the\n' +
          '     direct mongodb:// form (Atlas > Connect > "connection string" and pick\n' +
          '     an older driver version to reveal it).',
      );
    }
  } else {
    try {
      const { address } = await dns.lookup(firstHost);
      ok('hostname resolves', address);
    } catch (err) {
      bad('hostname resolves', err.code ?? err.message);
      problems.push('DNS cannot resolve the database host. Check your internet connection.');
    }
  }

  // TCP
  const port = Number(hostPart.split(',')[0].split(':')[1]) || 27017;
  const tcp = await new Promise((resolve) => {
    const sock = net.createConnection({ host: firstHost, port, timeout: 8000 });
    sock.on('connect', () => { sock.destroy(); resolve(null); });
    sock.on('timeout', () => { sock.destroy(); resolve('timed out'); });
    sock.on('error', (e) => resolve(e.code ?? e.message));
  });
  if (tcp) {
    bad(`TCP ${port}`, tcp);
    problems.push('Cannot open a TCP connection. A firewall is likely blocking port 27017.');
  } else {
    ok(`TCP ${port}`, 'reachable');
  }

  // Driver
  const t0 = Date.now();
  try {
    const { createMongoStore } = await import('../src/store/mongo.js');
    const store = await createMongoStore(config.MONGO_URI);
    await store.set('__doctor', 'ping', Date.now());
    await store.delete('__doctor', 'ping');
    await store.close();
    ok('driver connect + read/write', `${Date.now() - t0} ms`);
  } catch (err) {
    const msg = (err.message ?? String(err)).split('\n')[0];
    bad('driver connect', msg.slice(0, 100));

    if (/tlsv1 alert internal error|SSL routines/i.test(msg)) {
      problems.push(
        'Atlas rejected the TLS handshake. That happens before any password is\n' +
          `     checked, so it is a network rule, not your credentials — this IP\n` +
          `     (${publicIp ?? 'unknown'}) is not in the Atlas allowlist.\n` +
          '     Fix: Atlas > Network Access > Add IP Address. Use 0.0.0.0/0 if your\n' +
          '     home IP changes or you deploy to a host without a fixed IP.',
      );
    } else if (/auth|Authentication failed|bad auth/i.test(msg)) {
      problems.push('The username or password in MONGO_URI is wrong. Check Atlas > Database Access.');
    } else if (/querySrv|ECONNREFUSED/i.test(msg)) {
      problems.push('The SRV lookup failed — switch MONGO_URI to the direct mongodb:// form.');
    } else if (/timed out|ETIMEDOUT|ServerSelection/i.test(msg)) {
      problems.push(
        'Server selection timed out. Usually the IP allowlist, or a paused cluster\n' +
          '     (Atlas pauses free clusters after long inactivity — press Resume).',
      );
    }
  }
}

/* ── 3. media tooling ───────────────────────────────────────────────────── */

console.log('\n3 — media tooling');
try {
  const { default: ffmpegPath } = await import('ffmpeg-static');
  const fs = await import('node:fs');
  fs.existsSync(ffmpegPath) ? ok('ffmpeg binary', ffmpegPath) : bad('ffmpeg binary', 'missing — reinstall deps');
} catch {
  bad('ffmpeg binary', 'ffmpeg-static not installed');
}
try {
  const { version } = await import('../src/lib/ytdlp.js');
  ok('yt-dlp', await version());
} catch (err) {
  bad('yt-dlp', err.message.slice(0, 80));
}

/* ── summary ────────────────────────────────────────────────────────────── */

console.log('');
if (!problems.length) {
  console.log('  Everything checks out.\n');
} else {
  console.log(`  ${problems.length} problem${problems.length > 1 ? 's' : ''} found:\n`);
  for (const [i, p] of problems.entries()) console.log(`  ${i + 1}. ${p}\n`);
}

process.exitCode = problems.length ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 1500).unref();
