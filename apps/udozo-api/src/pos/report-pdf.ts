import PDFDocument from 'pdfkit';

export type ReportColumn = { label: string; width: number; align?: 'left' | 'right' };
export type ReportSection =
  | { heading: string; rows: Array<[string, string, boolean?]> }
  | { heading: string; columns: ReportColumn[]; table: string[][]; empty?: string };

/**
 * A plain A4 report for the shop's accountant (end of day, a period's summary): its title, who and when it is for,
 * then sections of figures (label and value) or tables (a new page repeats a table's headings). Amounts come already
 * worded with the currency's code, as the fonts lack ₦.
 */
export function reportPdf(input: { title: string; subtitle: string; meta: string[]; sections: ReportSection[] }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true, info: { Title: input.title, Creator: 'Udozo POS' } });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;
    const w = doc.page.width - left - doc.page.margins.right;
    const navy = '#10212e';
    const muted = '#5f6b73';
    const bottom = () => doc.page.height - doc.page.margins.bottom - 24;

    doc.font('Helvetica-Bold').fontSize(18).fillColor(navy).text(input.title, left, doc.y, { width: w });
    doc.font('Helvetica').fontSize(11).fillColor(navy).text(input.subtitle, left, doc.y, { width: w });
    doc.font('Helvetica').fontSize(9).fillColor(muted);
    for (const line of input.meta) doc.text(line, left, doc.y, { width: w });
    doc.moveDown(1);

    for (const section of input.sections) {
      if (doc.y > bottom() - 40) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(12).fillColor(navy).text(section.heading, left, doc.y, { width: w });
      doc.moveDown(0.3);
      if ('rows' in section) {
        for (const [label, value, bold] of section.rows) {
          if (doc.y > bottom()) doc.addPage();
          const y = doc.y;
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(navy);
          doc.text(label, left, y, { width: w * 0.6 });
          const after = doc.y;
          doc.text(value, left, y, { width: w, align: 'right' });
          doc.y = Math.max(after, doc.y) + 2;
        }
      } else {
        const scale = w / section.columns.reduce((sum, column) => sum + column.width, 0);
        const row = (cells: string[], bold: boolean, colour: string) => {
          const y = doc.y;
          let x = left;
          let end = y;
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(colour);
          section.columns.forEach((column, index) => {
            const width = column.width * scale;
            doc.text(cells[index] ?? '', x + 2, y, { width: width - 4, align: column.align ?? 'left' });
            end = Math.max(end, doc.y);
            x += width;
          });
          doc.y = end + 3;
          doc.save().moveTo(left, doc.y - 1).lineTo(left + w, doc.y - 1).lineWidth(0.4).strokeColor('#d6dde2').stroke().restore();
        };
        const headings = () => row(section.columns.map(column => column.label), true, muted);
        headings();
        if (!section.table.length) doc.font('Helvetica').fontSize(9).fillColor(muted).text(section.empty ?? 'None.', left, doc.y, { width: w });
        for (const cells of section.table) {
          if (doc.y > bottom()) {
            doc.addPage();
            headings();
          }
          row(cells, false, navy);
        }
      }
      doc.moveDown(1);
    }

    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(pages.start + index);
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(8).fillColor(muted).text(`Udozo POS · Page ${index + 1} of ${pages.count}`, left, doc.page.height - 28, { width: w, align: 'center' });
      doc.page.margins.bottom = margin;
    }
    doc.end();
  });
}
