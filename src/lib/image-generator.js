import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import config from '../config.js';

let client = null;
let active = false;
const waiting = [];

const ai = () => (client ??= new OpenAI({ apiKey: config.OPENAI_API_KEY }));

const sizes = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '3:4': '1024x1536',
};

async function acquire() {
  if (active) await new Promise((resolve) => waiting.push(resolve));
  active = true;
}

function release() {
  active = false;
  waiting.shift()?.();
}

function friendlyError(err) {
  const message = String(err?.message || err);
  if (/429|quota|resource_exhausted/i.test(message)) return new Error('Image quota reached. Try again later.');
  if (/401|403|api.?key|permission/i.test(message)) return new Error('The OpenAI API key cannot generate images. Check the key, billing, and organization verification.');
  if (/safety|blocked|prohibited/i.test(message)) return new Error('The image request was blocked by the provider safety filter.');
  return new Error(message.slice(0, 240));
}

/** Generate or edit one image; requests queue to control memory and API cost. */
export async function generateImage(prompt, { aspectRatio = '1:1', source = null, mimeType = 'image/jpeg' } = {}) {
  if (!prompt?.trim()) throw new Error('Describe the image you want.');
  if (prompt.length > 2000) throw new Error('Keep the image prompt under 2,000 characters.');

  await acquire();
  try {
    const options = {
      model: config.OPENAI_IMAGE_MODEL,
      prompt: prompt.trim(),
      size: sizes[aspectRatio] || '1024x1024',
      quality: 'medium',
    };
    const response = source
      ? await ai().images.edit({
          ...options,
          image: await toFile(source, 'source-image', { type: mimeType }),
        })
      : await ai().images.generate(options);

    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error('The model did not return an image.');

    let buffer = Buffer.from(encoded, 'base64');
    // Keep WhatsApp uploads and Railway memory predictable while preserving
    // transparency when the provider returns PNG artwork such as logos.
    if (buffer.length > 8 * 1024 * 1024) {
      buffer = await sharp(buffer).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    }
    return { buffer, mimeType: 'image/png' };
  } catch (err) {
    throw friendlyError(err);
  } finally {
    release();
  }
}

export const imageQueue = () => ({ active, waiting: waiting.length });

export default generateImage;
