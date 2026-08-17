import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import config, { ROOT } from '../config.js';

const resolveOptional = (value) => {
  if (!value) return '';
  const resolved = path.isAbsolute(value) ? value : path.resolve(ROOT, value);
  return fs.existsSync(resolved) ? resolved : '';
};

const cleanColor = (value) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#8B0000');

function text(value, fallback = '') {
  return String(value ?? fallback).replace(/\r\n/g, '\n').trim();
}

function normalizeDocument(input) {
  const sections = Array.isArray(input?.sections) ? input.sections.slice(0, 20) : [];
  return {
    title: text(input?.title, 'Document').slice(0, 160),
    subtitle: text(input?.subtitle).slice(0, 240),
    sections: sections.map((section) => ({
      heading: text(section?.heading).slice(0, 160),
      body: text(section?.body).slice(0, 12_000),
      bullets: Array.isArray(section?.bullets)
        ? section.bullets.map((item) => text(item).slice(0, 1000)).filter(Boolean).slice(0, 30)
        : [],
    })).filter((section) => section.heading || section.body || section.bullets.length),
    closing: text(input?.closing).slice(0, 4000),
  };
}

function drawHeader(doc, style) {
  const { width } = doc.page;
  doc.save();
  doc.rect(0, 0, width, 12).fill(style.accent);
  if (style.logo) {
    try {
      doc.image(style.logo, 48, 28, { fit: [92, 34], align: 'left', valign: 'center' });
    } catch {
      doc.fillColor(style.ink).fontSize(10).font(style.bold).text(style.brand, 48, 35, { width: 250 });
    }
  } else {
    doc.fillColor(style.ink).fontSize(10).font(style.bold).text(style.brand, 48, 35, { width: 250 });
  }
  doc.moveTo(48, 70).lineTo(width - 48, 70).lineWidth(0.7).strokeColor(style.rule).stroke();
  doc.restore();
  doc.x = 56;
  doc.y = 92;
}

function addFooters(doc, style) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const y = doc.page.height - 43;
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();
    doc.moveTo(48, y - 10).lineTo(doc.page.width - 48, y - 10).lineWidth(0.5).strokeColor(style.rule).stroke();
    doc.fillColor(style.muted).font(style.regular).fontSize(8)
      .text(style.footer, 48, y, { width: 390, lineBreak: false })
      .text(`${index + 1} / ${range.count}`, doc.page.width - 110, y, { width: 62, align: 'right', lineBreak: false });
    doc.restore();
    doc.page.margins.bottom = bottomMargin;
  }
}

/** Render structured content as a branded, downloadable PDF buffer. */
export async function generatePdf(content, overrides = {}) {
  const data = normalizeDocument(content);
  const customFont = resolveOptional(overrides.font ?? config.PDF_FONT);
  const style = {
    accent: cleanColor(overrides.accent ?? config.PDF_ACCENT_COLOR),
    brand: text(overrides.brand ?? config.PDF_BRAND_NAME, config.BOT_NAME),
    footer: text(overrides.footer ?? config.PDF_FOOTER, config.BOT_NAME),
    logo: resolveOptional(overrides.logo ?? config.PDF_LOGO),
    regular: customFont || 'Helvetica',
    bold: customFont || 'Helvetica-Bold',
    ink: '#171717',
    muted: '#666666',
    rule: '#D8D8D8',
  };

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 92, right: 56, bottom: 72, left: 56 },
    bufferPages: true,
    info: { Title: data.title, Author: style.brand, Creator: config.BOT_NAME },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const complete = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  drawHeader(doc, style);
  doc.on('pageAdded', () => drawHeader(doc, style));

  doc.fillColor(style.accent).font(style.bold).fontSize(27).text(data.title, { lineGap: 3 });
  if (data.subtitle) {
    doc.moveDown(0.35).fillColor(style.muted).font(style.regular).fontSize(11).text(data.subtitle, { lineGap: 3 });
  }
  doc.moveDown(1.2);

  for (const section of data.sections) {
    if (section.heading) {
      if (doc.y > doc.page.height - 155) doc.addPage();
      doc.fillColor(style.accent).font(style.bold).fontSize(15).text(section.heading, { lineGap: 2 });
      doc.moveDown(0.35);
    }
    if (section.body) {
      doc.fillColor(style.ink).font(style.regular).fontSize(10.5).text(section.body, {
        align: 'justify', lineGap: 4,
      });
      doc.moveDown(0.55);
    }
    for (const bullet of section.bullets) {
      doc.fillColor(style.accent).font(style.bold).fontSize(10.5).text('-', { continued: true, indent: 5 });
      doc.fillColor(style.ink).font(style.regular).text(`  ${bullet}`, { indent: 5, lineGap: 3 });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.65);
  }

  if (data.closing) {
    doc.moveDown(0.5).roundedRect(56, doc.y, doc.page.width - 112, 1, 0).fill(style.accent);
    doc.moveDown(0.8).fillColor(style.muted).font(style.regular).fontSize(10).text(data.closing, { lineGap: 4 });
  }

  addFooters(doc, style);
  doc.end();
  return complete;
}

export function pdfFileName(title = 'document') {
  const safe = text(title, 'document')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();
  return `${safe || 'document'}.pdf`;
}

export default generatePdf;
