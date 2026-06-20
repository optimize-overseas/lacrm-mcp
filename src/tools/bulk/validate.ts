/**
 * Dry-run validation for bulk operations.
 *
 * Pure and instance-agnostic: it inspects a parsed CSV against a caller-supplied
 * field configuration and reports what would happen — which configured columns are
 * present (and thus acted on), which are absent (and thus preserved, in update mode),
 * which headers are unknown, and any blocking problems (missing required columns or
 * values, etc.). It performs ZERO writes.
 *
 * @module tools/bulk/validate
 */

import type { FieldSpec } from './types.js';
import type { ParsedCsv } from './csv.js';

export interface RowIssue {
  /** 1-based data-row number (excludes the header row). */
  rowNumber: number;
  column: string;
}

export interface ValidationResult {
  ok: boolean;
  operation: 'create' | 'update';
  rowCount: number;
  /** Configured columns (plus the key) present in the file — these WILL be acted on. */
  presentColumns: string[];
  /** Configured field columns ABSENT from the file — left unchanged (update mode). */
  preservedColumns: string[];
  /** Headers in the file that are not part of the configuration — ignored. */
  unknownColumns: string[];
  /** Required columns (key + required fields) missing from the header — blocking. */
  missingRequiredColumns: string[];
  /** Rows where a required column's cell is blank — blocking. */
  rowsMissingRequiredValues: RowIssue[];
  /** Duplicate key values within the file (update mode) — warning. */
  duplicateKeys: { key: string; count: number }[];
  errors: string[];
  warnings: string[];
}

export interface ValidateInput {
  parsed: ParsedCsv;
  fields: FieldSpec[];
  operation: 'create' | 'update';
  /** Identity column for update mode (e.g. "Contact ID"); required present + per-row. */
  keyColumn?: string;
}

export function validateBulkCsv(input: ValidateInput): ValidationResult {
  const { parsed, fields, operation, keyColumn } = input;
  const headerSet = new Set(parsed.headers);
  const errors: string[] = [];
  const warnings: string[] = [];

  const fieldColumns = fields.map((f) => f.column);
  const configuredColumns = new Set<string>(fieldColumns);
  if (operation === 'update' && keyColumn) configuredColumns.add(keyColumn);

  // presentColumns = field columns acted on (the key is identity, reported via required checks, not here).
  const presentColumns = fieldColumns.filter((c) => headerSet.has(c));
  const preservedColumns = operation === 'update' ? fieldColumns.filter((c) => !headerSet.has(c)) : [];
  const unknownColumns = parsed.headers.filter((h) => !configuredColumns.has(h));

  // Required columns: the key (update) + any field flagged required.
  const requiredColumns: string[] = [];
  if (operation === 'update' && keyColumn) requiredColumns.push(keyColumn);
  for (const f of fields) if (f.required) requiredColumns.push(f.column);

  const missingRequiredColumns = requiredColumns.filter((c) => !headerSet.has(c));
  for (const col of missingRequiredColumns) {
    errors.push(`Required column "${col}" is missing from the file.`);
  }

  // Per-row blank checks for required columns that ARE present.
  const presentRequired = requiredColumns.filter((c) => headerSet.has(c));
  const rowsMissingRequiredValues: RowIssue[] = [];
  parsed.rows.forEach((row, index) => {
    for (const col of presentRequired) {
      if ((row[col] ?? '').trim() === '') {
        rowsMissingRequiredValues.push({ rowNumber: index + 1, column: col });
      }
    }
  });
  if (rowsMissingRequiredValues.length > 0) {
    errors.push(`${rowsMissingRequiredValues.length} row(s) are missing a required value.`);
  }

  // Duplicate key detection (update mode).
  const duplicateKeys: { key: string; count: number }[] = [];
  if (operation === 'update' && keyColumn && headerSet.has(keyColumn)) {
    const counts = new Map<string, number>();
    for (const row of parsed.rows) {
      const key = (row[keyColumn] ?? '').trim();
      if (key === '') continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      if (count > 1) duplicateKeys.push({ key, count });
    }
    if (duplicateKeys.length > 0) {
      warnings.push(`${duplicateKeys.length} duplicate key value(s) found; each would be applied more than once.`);
    }
  }

  if (unknownColumns.length > 0) {
    warnings.push(`Unrecognized column(s) will be ignored: ${unknownColumns.join(', ')}.`);
  }

  return {
    ok: errors.length === 0,
    operation,
    rowCount: parsed.rows.length,
    presentColumns,
    preservedColumns,
    unknownColumns,
    missingRequiredColumns,
    rowsMissingRequiredValues,
    duplicateKeys,
    errors,
    warnings,
  };
}
