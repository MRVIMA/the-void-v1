import { GoogleGenAI } from '@google/genai';
import { command } from '../core/registry.js';
import config from '../config.js';
import { log } from '../lib/logger.js';
import { detectType } from '../lib/media.js';

const logger = log('ai');

/** Created lazily so a missing key never breaks startup. */
let client = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }));

/**
 * Short conversational memory, per user, in RAM only.
 *
 * Persisting chat history would mean storing other people's messages
 * indefinitely, so it lives here and dies with the process.
 */
const HISTORY_TURNS = 8;
const histories = new Map();

function remember(number, role, text) {
  const list = histories.get(number) ?? [];
  list.push({ role, parts: [{ text }] });
  while (list.length > HISTORY_TURNS * 2) list.shift();
  histories.set(number, list);
}

const SYSTEM_PROMPT = `You are ${config.BOT_NAME}, a helpful assistant replying inside WhatsApp.
Keep answers short and conversational — a few sentences unless asked for detail.
Use WhatsApp formatting (*bold*, _italic_) sparingly. Never use markdown headings or tables.`;

command(
  {
    name: 'ai',
    alias: ['gemini', 'ask', 'chatgpt'],
    category: 'ai',
    desc: 'Ask the AI a question — reply to an image to ask about it',
    usage: '.ai why is the sky blue?',
    requires: ['GEMINI_API_KEY'],
    react: '🤖',
    cooldown: 5000,
  },
  async ({ m, text, number }) => {
    const target = m.quoted?.isMedia ? m.quoted : null;
    const prompt = text || (target ? 'Describe this in detail.' : '');
    if (!prompt) return m.reply('Ask me something, e.g. `.ai explain photosynthesis`');

    const contents = [];

    // Vision: attach the quoted image so the model can actually see it.
    if (target && (target.type === 'imageMessage' || target.type === 'stickerMessage')) {
      const buffer = await target.download();
      const { mime } = await detectType(buffer);
      contents.push({
        role: 'user',
        parts: [
          { inlineData: { mimeType: mime, data: buffer.toString('base64') } },
          { text: prompt },
        ],
      });
    } else {
      contents.push(...(histories.get(number) ?? []), { role: 'user', parts: [{ text: prompt }] });
    }

    const response = await ai().models.generateContent({
      model: config.GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 1200,
        temperature: 0.7,
      },
    });

    const answer = response.text?.trim();
    if (!answer) {
      logger.warn({ finishReason: response.candidates?.[0]?.finishReason }, 'empty AI response');
      return m.reply('🤖 I could not come up with an answer for that one.');
    }

    if (!target) {
      remember(number, 'user', prompt);
      remember(number, 'model', answer);
    }

    return m.reply(answer);
  },
);

command(
  {
    name: 'aiclear',
    alias: ['resetai', 'forget'],
    category: 'ai',
    desc: 'Forget our conversation history',
    react: '🧹',
  },
  async ({ m, number }) => {
    const had = histories.delete(number);
    return m.reply(had ? '🧹 Forgotten — starting fresh.' : 'There was nothing to forget.');
  },
);

command(
  {
    name: 'translate',
    alias: ['tr'],
    category: 'ai',
    desc: 'Translate text into another language',
    usage: '.translate si Hello, how are you?  (or reply to a message)',
    requires: ['GEMINI_API_KEY'],
    react: '🌐',
    cooldown: 4000,
  },
  async ({ m, args }) => {
    const [lang, ...rest] = args;
    const body = rest.join(' ') || m.quoted?.text;
    if (!lang || !body) {
      return m.reply('Usage: `.translate <language> <text>`\nOr reply to a message with `.translate <language>`.');
    }

    const response = await ai().models.generateContent({
      model: config.GEMINI_MODEL,
      contents: `Translate the following into ${lang}. Reply with the translation only, no preamble:\n\n${body}`,
      config: { temperature: 0.2, maxOutputTokens: 900 },
    });

    const out = response.text?.trim();
    return m.reply(out ? `🌐 ${out}` : 'Could not translate that.');
  },
);
