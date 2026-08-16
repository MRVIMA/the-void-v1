import { MongoClient } from 'mongodb';
import { log } from '../lib/logger.js';

const logger = log('store:mongo');

/**
 * MongoDB-backed key/value store, same interface as the SQLite driver.
 * Used when MONGO_URI is set — typically on hosts with an ephemeral disk
 * (Render, Koyeb, Heroku) where a local file would not survive a redeploy.
 *
 * Connects to *your* database. Nothing here talks to a third party.
 */
export async function createMongoStore(uri, dbName = 'whatsapp_bot') {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
  });

  let col;
  try {
    await client.connect();
    col = client.db(dbName).collection('kv');
    await col.createIndex({ ns: 1, key: 1 }, { unique: true });
    await col.createIndex({ ns: 1 });
  } catch (err) {
    // The caller falls back to SQLite, so this client is about to be dropped.
    // Without an explicit close its topology monitor keeps polling in the
    // background and holds the event loop open at shutdown.
    await client.close().catch(() => {});
    throw err;
  }

  logger.info({ db: dbName }, 'remote store ready');

  return {
    driver: 'mongodb',

    async get(ns, key) {
      const doc = await col.findOne({ ns, key: String(key) }, { projection: { value: 1 } });
      return doc ? doc.value : null;
    },

    async set(ns, key, value) {
      await col.updateOne(
        { ns, key: String(key) },
        { $set: { value: value ?? null, updatedAt: new Date() } },
        { upsert: true },
      );
      return value;
    },

    async delete(ns, key) {
      const res = await col.deleteOne({ ns, key: String(key) });
      return res.deletedCount > 0;
    },

    async clear(ns) {
      const res = await col.deleteMany({ ns });
      return res.deletedCount;
    },

    async all(ns) {
      const docs = await col.find({ ns }, { projection: { key: 1, value: 1 } }).sort({ key: 1 }).toArray();
      return docs.map((d) => ({ key: d.key, value: d.value }));
    },

    async count(ns) {
      return col.countDocuments({ ns });
    },

    async close() {
      await client.close();
    },
  };
}
