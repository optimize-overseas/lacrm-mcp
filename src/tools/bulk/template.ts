/**
 * CSV template generation for the bulk tools.
 *
 * Produces, from the caller-supplied field configuration, (1) a ready-to-fill CSV
 * (header-only by default) and (2) a plain-English per-field report describing what
 * happens when each column is populated, left blank, or omitted. Generated from the
 * SAME FieldSpec[] the validate/execute tools consume, so the report can never drift
 * from the rules actually enforced.
 *
 * Pure and instance-agnostic.
 *
 * @module tools/bulk/template
 */

import type { FieldSpec, MergeStrategy } from './types.js';
import { DEFAULT_JOIN_SEPARATOR } from './merge.js';
import { csvField } from './csv.js';

export interface GenerateTemplateInput {
  operation: 'create' | 'update';
  fields: FieldSpec[];
  /** Identity column for update mode; placed first and reported as the required key. */
  keyColumn?: string;
  /** Optional description for the key column in the report. */
  keyDescription?: string;
  /** When true, append a single example row built from each field's `example`. */
  includeExampleRow?: boolean;
  /** Update-mode structured-address column names; appended after fields with append-if-absent behavior. */
  addressColumns?: string[];
}

export interface FieldReportEntry {
  column: string;
  required: boolean;
  strategy: MergeStrategy | 'key';
  /** Plain-English do/don't-populate explanation. */
  behavior: string;
  description?: string;
}

export interface GeneratedTemplate {
  /** Header-only CSV (or header + one example row). */
  csv: string;
  /** Ordered, fillable column list (excludes never_write fields). */
  columns: string[];
  /** Per-field behavior report (includes never_write fields, marked locked). */
  report: FieldReportEntry[];
}

function updateBehavior(strategy: MergeStrategy, separator: string): string {
  switch (strategy) {
    case 'replace':
      return 'If provided, overwrites the field. If left BLANK, the field is CLEARED. If this column is omitted entirely, the existing value is preserved.';
    case 'preserve_if_blank':
      return 'If provided, overwrites the field. If left blank, the existing value is preserved. Omitting the column also preserves it.';
    case 'union_semicolon':
      return `Provided value(s) are ADDED to the existing list (semicolon-separated, joined with "${separator}"), de-duplicated. A blank cell or an omitted column preserves the existing list.`;
    case 'never_write':
      return 'This field is never modified by this operation; its existing value is always preserved.';
  }
}

function createBehavior(strategy: MergeStrategy, required: boolean): string {
  if (strategy === 'never_write') return 'This field is never set by this operation.';
  if (required) return 'Required. Must be provided for every new contact.';
  return 'Optional. The provided value is set on the new contact; a blank cell leaves it empty.';
}

/**
 * LACRM platform standard (built-in) fields — present in every LACRM account — in the
 * order they should appear in a template. Templates list standard fields first
 * (earlier/leftmost columns) and custom fields after (later/rightmost). The Address block
 * is positioned right after the contact name (see generateTemplate), so it is not listed
 * here. This is generic LACRM platform knowledge, not specific to any one account.
 */
const LACRM_STANDARD_FIELD_ORDER = [
  'Name', 'Company Name', 'Job Title', 'Email', 'Phone', 'Website', 'Background Info', 'Birthday', 'Industry',
];
const STANDARD_RANK = new Map(LACRM_STANDARD_FIELD_ORDER.map((name, i) => [name, i] as const));
/** The name field(s) the Address block is placed immediately after. */
const NAME_ANCHORS = new Set(['Name', 'Company Name']);

const ADDRESS_BEHAVIOR =
  'New address. Appended to the contact only if it is not already on the record ' +
  '(case/format-insensitive on Street/City/State/Zip; "St" = "Street"). If it matches an existing ' +
  'address, the CRM copy is kept and these cells are ignored. Existing addresses are never modified or removed.';

/** The LACRM field a spec writes to (defaults to the CSV column name). */
function targetKey(f: FieldSpec): string {
  return f.field ?? f.column;
}

/**
 * Split fields so LACRM standard (built-in) fields come first (in canonical order) and
 * custom fields come after (in supplied order), returned around the name anchors so the
 * caller can insert the Address block right after the contact name.
 */
function orderForTemplate(fields: FieldSpec[]): { nameAnchors: FieldSpec[]; otherStandard: FieldSpec[]; custom: FieldSpec[] } {
  const standard = fields
    .filter((f) => STANDARD_RANK.has(targetKey(f)))
    .sort((a, b) => STANDARD_RANK.get(targetKey(a))! - STANDARD_RANK.get(targetKey(b))!);
  return {
    nameAnchors: standard.filter((f) => NAME_ANCHORS.has(targetKey(f))),
    otherStandard: standard.filter((f) => !NAME_ANCHORS.has(targetKey(f))),
    custom: fields.filter((f) => !STANDARD_RANK.has(targetKey(f))),
  };
}

export function generateTemplate(input: GenerateTemplateInput): GeneratedTemplate {
  const { operation, fields, keyColumn, keyDescription, includeExampleRow, addressColumns } = input;
  const addressCols = addressColumns ?? [];

  // Column/report order: key -> contact name -> address block -> other LACRM standard fields
  // -> custom fields. LACRM built-in fields come first (leftmost) and custom fields last
  // (rightmost); the address block sits right after the contact name.
  const fillable = orderForTemplate(fields.filter((f) => f.strategy !== 'never_write'));
  const columns: string[] = [];
  if (operation === 'update' && keyColumn) columns.push(keyColumn);
  for (const f of fillable.nameAnchors) columns.push(f.column);
  for (const col of addressCols) columns.push(col);
  for (const f of fillable.otherStandard) columns.push(f.column);
  for (const f of fillable.custom) columns.push(f.column);

  const fieldEntry = (f: FieldSpec): FieldReportEntry => ({
    column: f.column,
    required: Boolean(f.required),
    strategy: f.strategy,
    behavior:
      operation === 'update'
        ? updateBehavior(f.strategy, f.separator ?? DEFAULT_JOIN_SEPARATOR)
        : createBehavior(f.strategy, Boolean(f.required)),
    description: f.description,
  });

  // Report (includes never_write fields), in the same order as the columns.
  const ordered = orderForTemplate(fields);
  const report: FieldReportEntry[] = [];
  if (operation === 'update' && keyColumn) {
    report.push({
      column: keyColumn,
      required: true,
      strategy: 'key',
      behavior: "Required. The contact's identifier — every row must include it.",
      description: keyDescription,
    });
  }
  for (const f of ordered.nameAnchors) report.push(fieldEntry(f));
  for (const col of addressCols) report.push({ column: col, required: false, strategy: 'preserve_if_blank', behavior: ADDRESS_BEHAVIOR });
  for (const f of ordered.otherStandard) report.push(fieldEntry(f));
  for (const f of ordered.custom) report.push(fieldEntry(f));

  const lines: string[] = [columns.map(csvField).join(',')];
  if (includeExampleRow) {
    const exampleByColumn = new Map(fields.map((f) => [f.column, f.example ?? '']));
    const exampleRow = columns.map((col) => csvField(exampleByColumn.get(col) ?? ''));
    lines.push(exampleRow.join(','));
  }

  return { csv: lines.join('\n'), columns, report };
}
