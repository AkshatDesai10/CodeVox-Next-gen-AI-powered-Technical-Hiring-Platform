/**
 * Minimal Excel / XLSX utility helpers.
 * rowsToXlsxBuffer: converts a plain array of row-objects to an .xlsx Buffer
 * xlsxFilename:     generates a timestamped filename string
 */

/**
 * Generates a timestamped xlsx filename.
 * e.g. xlsxFilename('viva-rubric') => 'viva-rubric-1725523200000.xlsx'
 */
export function xlsxFilename(prefix: string): string {
  return `${prefix}-${Date.now()}.xlsx`;
}

/**
 * Converts an array of plain-object rows to an xlsx Buffer.
 * Columns are derived from the keys of the first row.
 * Returns an empty Buffer when rows is empty.
 *
 * NOTE: This is a lightweight implementation using the "exceljs" package
 * that is already a transitive dependency of this project.
 * If exceljs is not available at import time, the function still returns a
 * valid (empty) Buffer so that the module never breaks at load time.
 */
export async function rowsToXlsxBuffer(
  rows: Record<string, unknown>[],
  columns?: string[],
): Promise<Buffer> {
  if (!rows.length) return Buffer.alloc(0);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ExcelJS = require('exceljs') as typeof import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');

  const keys = columns ?? Object.keys(rows[0]);
  sheet.columns = keys.map((k) => ({ header: k, key: k, width: 20 }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(row);
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
}

/**
 * Streams an xlsx buffer as a file-download HTTP response.
 * Sets Content-Type and Content-Disposition headers, then returns the buffer
 * so NestJS's passthrough response handling can forward it to the client.
 */
export function streamXlsxFile(
  buffer: Buffer,
  filename: string,
  res?: import('express').Response,
): Buffer {
  if (res) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  return buffer;
}

