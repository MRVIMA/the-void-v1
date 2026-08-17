import { GoogleGenAI } from '@google/genai';
import { command } from '../core/registry.js';
import config from '../config.js';
import { status } from '../lib/deliver.js';
import { bytes } from '../lib/format.js';
import { generatePdf, pdfFileName } from '../lib/pdf-generator.js';

let client = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY }));

const DOCUMENT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          body: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['heading', 'body', 'bullets'],
      },
    },
    closing: { type: 'string' },
  },
  required: ['title', 'subtitle', 'sections', 'closing'],
};

async function createDocument(prompt, quotedText = '') {
  const source = quotedText
    ? `User instructions:\n${prompt || 'Turn the supplied text into a polished document.'}\n\nSupplied text:\n${quotedText}`
    : prompt;
  const response = await ai().models.generateContent({
    model: config.GEMINI_MODEL,
    contents: source,
    config: {
      systemInstruction:
        'Create a polished document from the request. Be accurate, useful, and concise. ' +
        'Do not invent factual claims. Use clear section headings, prose, and bullets where appropriate.',
      maxOutputTokens: 5000,
      responseMimeType: 'application/json',
      responseSchema: DOCUMENT_SCHEMA,
    },
  });
  if (!response.text) throw new Error('Gemini returned no document content.');
  return JSON.parse(response.text);
}

command(
  {
    name: 'pdf',
    alias: ['createpdf', 'document'],
    category: 'document',
    desc: 'Create and download a styled PDF from a prompt or replied text',
    usage: '.pdf Create a professional project proposal for Acme',
    requires: ['GEMINI_API_KEY'],
    react: '📄',
    cooldown: 20_000,
  },
  async ({ m, text }) => {
    const quotedText = m.quoted?.text?.trim() || '';
    if (!text && !quotedText) {
      return m.reply('Describe the PDF you want, or reply to text with `.pdf`.');
    }
    if (text.length + quotedText.length > 20_000) {
      return m.reply('That source is too long. Keep the prompt and replied text under 20,000 characters.');
    }

    const bar = await status(m, '📄 Writing your document…');
    const content = await createDocument(text, quotedText);
    await bar.update('🎨 Applying your PDF style…');
    const buffer = await generatePdf(content);
    const fileName = pdfFileName(content.title);
    await bar.update(`📤 Sending ${bytes(buffer.length)}…`);
    await m.reply({
      document: buffer,
      mimetype: 'application/pdf',
      fileName,
      caption: `📄 *${content.title}*\n${config.PDF_FOOTER}`,
    });
    return bar.update('✅ PDF created and sent.');
  },
);

command(
  {
    name: 'pdfstyle',
    category: 'document',
    desc: 'Show the configured PDF branding',
    react: '🎨',
  },
  async ({ m }) => m.reply(
    `🎨 *PDF style*\n` +
    `Brand: ${config.PDF_BRAND_NAME}\n` +
    `Accent: ${config.PDF_ACCENT_COLOR}\n` +
    `Footer: ${config.PDF_FOOTER}\n` +
    `Logo: ${config.PDF_LOGO || 'none'}\n` +
    `Font: ${config.PDF_FONT || 'built-in Helvetica'}`,
  ),
);
