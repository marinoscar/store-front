import PDFDocument from 'pdfkit';
import { getObjectBuffer } from './s3.js';
import type { SiteConfig } from '../config.js';

export type QuotePdfInput = {
  quoteId: string;
  site: SiteConfig;
  serviceName: string;
  customer: { name: string; email: string; phone: string };
  address: string;
  notes?: string;
  estimate?: { low: number; high: number; currency: string };
  photoKeys: string[];
};

/**
 * Render a branded quote PDF and return it as a Buffer.
 */
export async function renderQuotePdf(input: QuotePdfInput): Promise<Buffer> {
  const primary = input.site.pdfTheme.primary || '#111827';
  const accent = input.site.pdfTheme.accent || '#f59e0b';

  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Header band
  doc.rect(0, 0, doc.page.width, 80).fill(primary);
  if (input.site.pdfTheme.logoS3Key) {
    const logo = await getObjectBuffer(input.site.pdfTheme.logoS3Key);
    if (logo) {
      try {
        doc.image(logo, 40, 18, { height: 44 });
      } catch {
        /* malformed logo — skip silently */
      }
    }
  }
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(20)
    .text(input.site.brandName, 40, 28, { align: 'right', width: doc.page.width - 80 });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text(`Quote #${input.quoteId}`, 40, 56, { align: 'right', width: doc.page.width - 80 });

  doc.fillColor('#111827').moveDown(2);

  // Customer block
  doc.font('Helvetica-Bold').fontSize(12).text('Prepared for', 54, 110);
  doc.font('Helvetica').fontSize(11).fillColor('#374151');
  doc.text(input.customer.name);
  doc.text(input.customer.email);
  doc.text(input.customer.phone);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fillColor('#111827').text('Service address');
  doc.font('Helvetica').fillColor('#374151').text(input.address);
  doc.moveDown(1);

  // Service
  doc.font('Helvetica-Bold').fillColor('#111827').fontSize(14).text('Service');
  doc.font('Helvetica').fillColor('#374151').fontSize(12).text(input.serviceName);
  doc.moveDown(0.5);

  if (input.notes) {
    doc.font('Helvetica-Bold').fillColor('#111827').fontSize(12).text('Notes');
    doc.font('Helvetica').fillColor('#374151').fontSize(11).text(input.notes);
    doc.moveDown(0.5);
  }

  // Estimate
  if (input.estimate) {
    const { currency, low, high } = input.estimate;
    doc.rect(54, doc.y, doc.page.width - 108, 60).fill(accent);
    doc
      .fillColor('#111827')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Estimated range', 70, doc.y - 50);
    doc
      .font('Helvetica-Bold')
      .fontSize(22)
      .text(`${currency} ${low.toLocaleString()} – ${high.toLocaleString()}`, 70, doc.y - 32);
    doc.moveDown(2);
    doc.fillColor('#111827');
  }

  // Photo thumbnails
  if (input.photoKeys.length > 0) {
    doc.font('Helvetica-Bold').fillColor('#111827').fontSize(14).text('Photos');
    doc.moveDown(0.5);
    const thumbW = 150;
    const thumbH = 100;
    const cols = 3;
    let x = 54;
    let y = doc.y;
    let inRow = 0;

    for (const key of input.photoKeys) {
      const buf = await getObjectBuffer(key);
      if (!buf) continue;
      try {
        doc.image(buf, x, y, { width: thumbW, height: thumbH, fit: [thumbW, thumbH] });
      } catch {
        /* unreadable image — skip */
      }
      x += thumbW + 10;
      inRow += 1;
      if (inRow >= cols) {
        x = 54;
        y += thumbH + 10;
        inRow = 0;
      }
    }
    doc.moveDown(1);
  }

  // Footer
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#6b7280')
    .text(
      `${input.site.brandName} • ${input.site.phone} • Estimate only — subject to on-site inspection.`,
      54,
      doc.page.height - 60,
      { align: 'center', width: doc.page.width - 108 },
    );

  doc.end();
  return done;
}
