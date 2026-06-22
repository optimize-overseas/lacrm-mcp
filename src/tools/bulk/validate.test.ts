import { describe, it, expect } from 'vitest';
import { validateBulkCsv } from './validate.js';
import type { FieldSpec } from './types.js';

const UPDATE_FIELDS: FieldSpec[] = [
  { column: 'Full Name', field: 'FullName', strategy: 'replace' },
  { column: 'Status', strategy: 'replace' },
  { column: 'Tags', strategy: 'union_semicolon' },
  { column: 'Region', strategy: 'replace' },
];

describe('validateBulkCsv — update mode', () => {
  it('passes a well-formed file and reports present vs preserved columns', () => {
    const result = validateBulkCsv({
      operation: 'update',
      keyColumn: 'Contact ID',
      fields: UPDATE_FIELDS,
      parsed: {
        headers: ['Contact ID', 'Full Name', 'Status'],
        rows: [
          { 'Contact ID': '1', 'Full Name': 'Jane', 'Status': 'A' },
          { 'Contact ID': '2', 'Full Name': 'Bob', 'Status': '' },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.rowCount).toBe(2);
    // configured columns that ARE present (will be acted on):
    expect(result.presentColumns.sort()).toEqual(['Status', 'Full Name'].sort());
    // configured columns ABSENT from the file (left unchanged):
    expect(result.preservedColumns.sort()).toEqual(['Region', 'Tags'].sort());
    expect(result.errors).toEqual([]);
  });

  it('blocks when the key column is absent', () => {
    const result = validateBulkCsv({
      operation: 'update',
      keyColumn: 'Contact ID',
      fields: UPDATE_FIELDS,
      parsed: { headers: ['Full Name'], rows: [{ 'Full Name': 'Jane' }] },
    });
    expect(result.ok).toBe(false);
    expect(result.missingRequiredColumns).toContain('Contact ID');
  });

  it('blocks when a row is missing its key value', () => {
    const result = validateBulkCsv({
      operation: 'update',
      keyColumn: 'Contact ID',
      fields: UPDATE_FIELDS,
      parsed: { headers: ['Contact ID', 'Full Name'], rows: [{ 'Contact ID': '', 'Full Name': 'Jane' }] },
    });
    expect(result.ok).toBe(false);
    expect(result.rowsMissingRequiredValues).toEqual([{ rowNumber: 1, column: 'Contact ID' }]);
  });

  it('reports unknown columns as warnings without blocking', () => {
    const result = validateBulkCsv({
      operation: 'update',
      keyColumn: 'Contact ID',
      fields: UPDATE_FIELDS,
      parsed: { headers: ['Contact ID', 'Mystery Column'], rows: [{ 'Contact ID': '1', 'Mystery Column': 'x' }] },
    });
    expect(result.ok).toBe(true);
    expect(result.unknownColumns).toEqual(['Mystery Column']);
    expect(result.warnings.join(' ')).toMatch(/Mystery Column/);
  });

  it('warns on duplicate key values within the file', () => {
    const result = validateBulkCsv({
      operation: 'update',
      keyColumn: 'Contact ID',
      fields: UPDATE_FIELDS,
      parsed: { headers: ['Contact ID'], rows: [{ 'Contact ID': '7' }, { 'Contact ID': '7' }] },
    });
    expect(result.duplicateKeys).toEqual([{ key: '7', count: 2 }]);
    expect(result.warnings.join(' ')).toMatch(/duplicate/i);
  });

  it('recognizes address columns as present (not unknown)', () => {
    const result = validateBulkCsv({
      operation: 'update',
      keyColumn: 'Contact ID',
      fields: [],
      parsed: { headers: ['Contact ID', 'Address Line 1', 'City', 'State', 'Zip'], rows: [] },
      addressColumns: ['Address Line 1', 'City', 'State', 'Zip'],
    });
    expect(result.unknownColumns).toEqual([]);
    expect(result.presentColumns).toEqual(expect.arrayContaining(['Address Line 1', 'City', 'State', 'Zip']));
  });
});

describe('validateBulkCsv — create mode', () => {
  const CREATE_FIELDS: FieldSpec[] = [
    { column: 'Full Name', field: 'FullName', strategy: 'replace', required: true },
    { column: 'Status', strategy: 'replace' },
  ];

  it('passes a valid create file (no key column required)', () => {
    const result = validateBulkCsv({
      operation: 'create',
      fields: CREATE_FIELDS,
      parsed: { headers: ['Full Name', 'Status'], rows: [{ 'Full Name': 'Jane', 'Status': 'A' }] },
    });
    expect(result.ok).toBe(true);
  });

  it('blocks when a required field column is absent', () => {
    const result = validateBulkCsv({
      operation: 'create',
      fields: CREATE_FIELDS,
      parsed: { headers: ['Status'], rows: [{ 'Status': 'A' }] },
    });
    expect(result.ok).toBe(false);
    expect(result.missingRequiredColumns).toContain('Full Name');
  });

  it('blocks when a required field value is blank in a row', () => {
    const result = validateBulkCsv({
      operation: 'create',
      fields: CREATE_FIELDS,
      parsed: { headers: ['Full Name', 'Status'], rows: [{ 'Full Name': '', 'Status': 'A' }] },
    });
    expect(result.ok).toBe(false);
    expect(result.rowsMissingRequiredValues).toEqual([{ rowNumber: 1, column: 'Full Name' }]);
  });
});
