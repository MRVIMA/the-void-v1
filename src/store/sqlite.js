import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { log } from '../lib/logger.js';

const logger = log('store:sqlite');

/**
 * Local key/value store backed by Node's built-in SQLite (Node >= 22.5).
 * No native compilation, no external service, survives restarts.
 *
 * Layout: a single `kv` table namespaced by `ns`, values stored as JSON.
 */
export function createSqliteStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous  = NORMAL;
    CREATE TABLE IF NOT EXISTS kv (
      ns         TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (ns, key)
    );
    CREATE INDEX IF NOT EXISTS kv_ns_idx ON kv (ns);
  `);

  const stmt = {
    get: db.prepare('SELECT value FROM kv WHERE ns = ? AND key = ?'),
    set: db.prepare(
      `INSERT INTO kv (ns, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ),
    del: db.prepare('DELETE FROM kv WHERE ns = ? AND key = ?'),
    clear: db.prepare('DELETE FROM kv WHERE ns = ?'),
    all: db.prepare('SELECT key, value FROM kv WHERE ns = ? ORDER BY key'),
    count: db.prepare('SELECT COUNT(*) AS n FROM kv WHERE ns = ?'),
  };

  logger.info({ file }, 'local store ready');

  return {
    driver: 'sqlite',

    async get(ns, key) {
      const row = stmt.get.get(ns, String(key));
      if (!row) return null;
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    },

    async set(ns, key, value) {
      stmt.set.run(ns, String(key), JSON.stringify(value ?? null), Date.now());
      return value;
    },

    async delete(ns, key) {
      return stmt.del.run(ns, String(key)).changes > 0;
    },

    async clear(ns) {
      return stmt.clear.run(ns).changes;
    },

    async all(ns) {
      return stmt.all.all(ns).map((r) => {
        let value = null;
        try {
          value = JSON.parse(r.value);
        } catch {
          /* corrupt row — treated as absent */
        }
        return { key: r.key, value };
      });
    },

    async count(ns) {
      return stmt.count.get(ns)?.n ?? 0;
    },

    async close() {
      db.close();
    },
  };
}
