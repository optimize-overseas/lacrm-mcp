/**
 * CSV parsing for the bulk tools.
 *
 * Uses csv-parse (RFC-4180 compliant) so real-world spreadsheet exports — quoted
 * fields, embedded commas/newlines, doubled quotes, BOM — are handled correctly.
 *
 * @module tools/bulk/csv
 */

import { parse } from 'csv-parse/sync';

export interface ParsedCsv {
  /** Header names, in order, trimmed. */
  headers: string[];
  /** One object per data row, keyed by (trimmed) header name. */
  rows: Record<string, string>[];
}

/**
 * Parse CSV text into headers + header-keyed rows.
 *
 * Tolerant of the messiness of staff-produced files: strips a UTF-8 BOM, trims
 * header and cell whitespace, skips blank lines, and allows ragged column counts.
 */
export function parseCsv(text: string): ParsedCsv {
  let headers: string[] = [];
  const rows = parse(text, {
    bom: true,
    columns: (firstRow: string[]) => {
      headers = firstRow.map((header) => header.trim());
      return headers;
    },
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];

  return { headers, rows };
}

/** Escape one CSV field per RFC-4180: quote if it contains a comma, quote, CR or LF. */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Render one CSV line from field values, escaping each. */
export function csvRow(values: string[]): string {
  return values.map(csvField).join(',');
}
