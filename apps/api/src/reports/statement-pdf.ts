import PDFDocument from 'pdfkit';

export type StatementRow = { date: string; reference: string; type: string; description: string; label: string; currency: string; debit: number | null; credit: number | null };

const amount = (minor: number | null, currency: string) => (minor === null ? '' : `${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`);
const shortDate = (iso: string) => iso.slice(0, 10);

/**
 * A simple, dated statement: BitoCard's header, the period, every row with its debit or credit, and the P&L
 * totals. Returns the finished PDF as a buffer. One page of rows at a time; a new page repeats the column headings.
 */
export function statementPdf(input: {
  title: string;
  from: string;
  to: string;
  currency: string;
  rows: StatementRow[];
  totals: { revenue: number; cost_of_sales: number; gross_profit: number; operating_expenses: number; net_profit: number };
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const columns = [
      { label: 'Date', width: 60 },
      { label: 'Reference', width: 110 },
      { label: 'Description', width: 190 },
      { label: 'Debit', width: 70 },
      { label: 'Credit', width: 70 },
    ];
    const left = doc.page.margins.left;

    const heading = () => {
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#070f4c').text('BitoCard', left, doc.y);
      doc.font('Helvetica').fontSize(9).fillColor('#5b6488').text('A Golojan Ltd venture');
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#070f4c').text(input.title);
      doc.font('Helvetica').fontSize(10).fillColor('#333').text(`${shortDate(input.from)} to ${shortDate(input.to)} · ${input.currency}`);
      doc.moveDown(0.8);
    };

    const columnHeader = () => {
      let x = left;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#070f4c');
      for (const column of columns) {
        doc.text(column.label, x, doc.y, { width: column.width, continued: false });
        x += column.width;
      }
      doc.moveDown(0.3);
      doc.moveTo(left, doc.y).lineTo(left + columns.reduce((sum, column) => sum + column.width, 0), doc.y).strokeColor('#dbe0f0').stroke();
      doc.moveDown(0.3);
    };

    heading();
    columnHeader();
    doc.font('Helvetica').fontSize(8.5).fillColor('#111');
    for (const row of input.rows) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        columnHeader();
        doc.font('Helvetica').fontSize(8.5).fillColor('#111');
      }
      const top = doc.y;
      let x = left;
      const cells = [shortDate(row.date), row.reference, `${row.label}: ${row.description}`, amount(row.debit, row.currency), amount(row.credit, row.currency)];
      for (let index = 0; index < columns.length; index++) {
        doc.text(cells[index], x, top, { width: columns[index].width });
        x += columns[index].width;
      }
      doc.moveDown(0.2);
    }

    if (doc.y > doc.page.height - doc.page.margins.bottom - 120) doc.addPage();
    doc.moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(left + columns.reduce((sum, column) => sum + column.width, 0), doc.y).strokeColor('#070f4c').stroke();
    doc.moveDown(0.4);
    const line = (label: string, value: number, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#070f4c');
      doc.text(label, left, doc.y, { width: 300, continued: true });
      doc.text(`${(value / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${input.currency}`, { width: 200, align: 'right' });
    };
    line('Revenue', input.totals.revenue);
    line('Cost of sales', -input.totals.cost_of_sales);
    line('Gross profit', input.totals.gross_profit, true);
    line('Operating expenses', -input.totals.operating_expenses);
    line('Net profit', input.totals.net_profit, true);

    doc.end();
  });
}
