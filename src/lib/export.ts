import type { Response } from 'express';
import ExcelJS from 'exceljs';

import { AppError } from './errors.js';

/** One column of a list export: the header the page shows and how to read it from a listed row. */
export interface ExportColumn {
  header: string;
  value: (row: Record<string, unknown>, index: number) => unknown;
  width?: number;
  /** Excel number format, e.g. '#,##0.00' for acres. */
  numFmt?: string;
}

export const EXPORT_FORMATS = ['xlsx', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** `?format=` of an export: xlsx when left out; anything else is a 400 on `format`. */
export function exportFormat(value: unknown): ExportFormat {
  if (value === undefined || value === '') return 'xlsx';
  if (typeof value === 'string' && (EXPORT_FORMATS as readonly string[]).includes(value))
    return value as ExportFormat;
  throw new AppError('VALIDATION', 'Please correct the highlighted fields.', {
    format: 'Use xlsx or csv.',
  });
}

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Sends rows as `<fileName>-YYYY-MM-DD.xlsx` (one bold, frozen header row) or as a UTF-8 CSV. */
export async function sendExport(
  res: Response,
  format: ExportFormat,
  opts: { fileName: string; sheet: string; columns: ExportColumn[]; rows: Record<string, unknown>[] },
) {
  const name = `${opts.fileName}-${new Date().toISOString().slice(0, 10)}.${format}`;
  const values = opts.rows.map((row, i) => opts.columns.map((c) => c.value(row, i)));
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const lines = [opts.columns.map((c) => csvCell(c.header)), ...values.map((r) => r.map(csvCell))];
    // The BOM makes Excel read the file as UTF-8.
    res.send(`\uFEFF${lines.map((l) => l.join(',')).join('\r\n')}\r\n`);
    return;
  }
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(opts.sheet);
  sheet.columns = opts.columns.map((c) => ({
    header: c.header,
    width: c.width ?? Math.max(12, c.header.length + 2),
    style: c.numFmt ? { numFmt: c.numFmt } : {},
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of values) sheet.addRow(r);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(Buffer.from(await book.xlsx.writeBuffer()));
}
