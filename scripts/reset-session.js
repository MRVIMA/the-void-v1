#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline/promises';
import config from '../src/config.js';

/**
 * Deletes the local session so the next start pairs fresh.
 *
 * Run this after "logged out" in the logs, or when moving the bot to a new
 * number. It only ever touches SESSION_DIR — never the rest of the project,
 * which is what the original project's `.update` command got wrong.
 */

const dir = config.SESSION_DIR;

if (!fs.existsSync(dir)) {
  console.log(`Nothing to do — no session at ${dir}`);
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  `This deletes the WhatsApp session at:\n  ${dir}\n\nYou will need to scan a QR or pair again. Continue? (y/N) `,
);
rl.close();

if (answer.trim().toLowerCase() !== 'y') {
  console.log('Cancelled.');
  process.exit(0);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}. Run "npm start" to link again.`);
