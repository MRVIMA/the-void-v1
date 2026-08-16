#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import config from '../src/config.js';

/**
 * Prints the current WhatsApp login as a single base64 string.
 *
 * Set it as SESSION_ID on a host with an ephemeral filesystem and the bot
 * restores the login on boot instead of showing a QR nobody can scan. Pair
 * once locally, deploy anywhere.
 */

const credsPath = path.join(config.SESSION_DIR, 'creds.json');

if (!fs.existsSync(credsPath)) {
  console.error(`No session found at ${credsPath}`);
  console.error('Run "npm start" and link your phone first.');
  process.exit(1);
}

const raw = fs.readFileSync(credsPath, 'utf-8');

try {
  const parsed = JSON.parse(raw);
  if (!parsed?.noiseKey || !parsed?.me) throw new Error('missing noiseKey/me');

  const encoded = Buffer.from(raw, 'utf-8').toString('base64');

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log(` Logged in as : ${parsed.me?.name ?? '(no name)'} · ${parsed.me?.id?.split(':')[0] ?? '?'}`);
  console.log(` Size         : ${encoded.length} characters`);
  console.log('─────────────────────────────────────────────────────────────\n');
  console.log('Set this as the SESSION_ID environment variable on your host:\n');
  console.log(encoded);
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log(' This IS your WhatsApp login. Anyone holding it can read and');
  console.log(' send your messages. Never paste it into a chat, an issue, or');
  console.log(' a public repo. If it leaks: WhatsApp > Linked devices > log');
  console.log(' the device out, then pair again.');
  console.log('─────────────────────────────────────────────────────────────\n');
} catch (err) {
  console.error(`Session file is not valid JSON credentials: ${err.message}`);
  process.exit(1);
}
