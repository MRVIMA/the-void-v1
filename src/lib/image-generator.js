import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';
import config from '../config.js';

let client = null;
let active = false;
const waiting = [];

const ai = () => (client ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }));

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
  if (/401|403|api.?key|permission/i.test(message)) return new Error('The Gemini API key cannot generate images. Check the key and API access.');
  if (/safety|blocked|prohibited/i.test(message)) return new Error('The image request was blocked by the provider safety filter.');
  return new Error(message.slice(0, 240));
}

/** Generate or edit one image; requests queue to control memory and API cost. */
export async function generateImage(prompt, { aspectRatio = '1:1', source = null, mimeType = 'image/jpeg' } = {}) {
  if (!prompt?.trim()) throw new Error('Describe the image you want.');
  if (prompt.length > 2000) throw new Error('Keep the image prompt under 2,000 characters.');

  await acquire();
  try {
    const contents = source
      ? [
          { inlineData: { mimeType, data: source.toString('base64') } },
          { text: prompt.trim() },
        ]
      : prompt.trim();

    const response = await ai().models.generateContent({
      model: config.GEMINI_IMAGE_MODEL,
      contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio, imageSize: '1K' },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const images = parts.filter((part) => part.inlineData?.data && !part.thought);
    const part = images.at(-1) ?? parts.filter((item) => item.inlineData?.data).at(-1);
    if (!part) {
      const reason = response.candidates?.[0]?.finishReason || 'no image returned';
      throw new Error(`The model did not return an image (${reason}).`);
    }

    let buffer = Buffer.from(part.inlineData.data, 'base64');
    // Keep WhatsApp uploads and Railway memory predictable while preserving
    // transparency when the provider returns PNG artwork such as logos.
    if (buffer.length > 8 * 1024 * 1024) {
      buffer = await sharp(buffer).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    }
    return { buffer, mimeType: part.inlineData.mimeType || 'image/png' };
  } catch (err) {
    throw friendlyError(err);
  } finally {
    release();
  }
}

export const imageQueue = () => ({ active, waiting: waiting.length });

export default generateImage;
