import axios from 'axios';
import config from '../config.js';
import { log } from './logger.js';

const logger = log('http');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Shared axios instance: sane timeout, browser UA, no infinite redirects. */
export const http = axios.create({
  timeout: config.REQUEST_TIMEOUT_MS,
  maxRedirects: 5,
  headers: { 'User-Agent': UA, Accept: '*/*' },
  // Let us inspect 4xx bodies instead of throwing on them.
  validateStatus: (s) => s >= 200 && s < 500,
});

/** Retries transient failures (timeouts, 5xx, socket resets) with backoff. */
async function withRetry(fn, { retries = 2, baseDelay = 600 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient =
        !err.response ||
        err.code === 'ECONNABORTED' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        (err.response?.status >= 500 && err.response?.status < 600);
      if (!transient || attempt === retries) break;
      const wait = baseDelay * 2 ** attempt;
      logger.debug({ attempt: attempt + 1, wait }, 'retrying request');
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** GET JSON. Throws a readable error instead of an axios blob. */
export async function getJson(url, options = {}) {
  const res = await withRetry(() => http.get(url, options));
  if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.data;
}

/** GET as Buffer — for images, audio, video and other binaries. */
export async function getBuffer(url, options = {}) {
  const res = await withRetry(() => http.get(url, { ...options, responseType: 'arraybuffer' }));
  if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return Buffer.from(res.data);
}

export async function postJson(url, body, options = {}) {
  const res = await withRetry(() => http.post(url, body, options));
  if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.data;
}

/** HEAD request returning `{ type, size }` without downloading the body. */
export async function probe(url) {
  const res = await http.head(url).catch(() => null);
  if (!res) return { type: null, size: null };
  return {
    type: res.headers['content-type']?.split(';')[0] ?? null,
    size: Number(res.headers['content-length']) || null,
  };
}

/** True for a syntactically valid http(s) URL. */
export function isUrl(text = '') {
  try {
    const u = new URL(String(text).trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default http;
