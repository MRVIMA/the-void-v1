import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL || (isDev ? 'info' : 'warn');

/**
 * Root logger. Pretty-printed in development, JSON lines in production so
 * hosting platforms can index it.
 */
export const logger = pino(
  { level, base: undefined },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      })
    : undefined,
);

/** Child logger tagged with a subsystem name, e.g. `log('socket')`. */
export const log = (name) => logger.child({ mod: name });

/**
 * Baileys is extremely chatty at debug level and logs every decryption
 * attempt. It gets its own silent logger unless BAILEYS_LOG is set.
 */
export const baileysLogger = pino({ level: process.env.BAILEYS_LOG || 'silent' });

/** Boot banner lines — plain console so they survive any log level. */
export const banner = (lines) => {
  const width = Math.max(...lines.map((l) => [...l].length), 34);
  const bar = '─'.repeat(width + 2);
  console.log(`\n╭${bar}╮`);
  for (const line of lines) console.log(`│ ${line.padEnd(width)} │`);
  console.log(`╰${bar}╯\n`);
};
