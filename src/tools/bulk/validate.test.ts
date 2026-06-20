import { describe, it, expect } from 'vitest';
import { validateBulkCsv } from './validate.js';
import type { FieldSpec } from './types.js';

const UPDATE_FIELDS: FieldSpec[] = [
  { column: 'Owner Name', field: 'FullName', strategy: 'replace' },
  { column: '$ Offer', strategy: 'replace' },
  { column: 'Owner Name Aliases', strategy: 'union_semicolon' },
  { column: 'County', strategy: 'replace' },
];

describe('validateBulkCsv — update mode', () => {
  it('passes a well-formed file and reports present vs preserved columns', () => {
    const result = validateBulkCsv({
      operation: 'update',
      keyColumn: 'Contact ID',
      fields: UPDATE_FIELDS,
      parsed: {
        headers: ['Contact ID', 'Owner Name', '$ Offer'],
        rows: [
          { 'Contact ID': '1', 'Owner Name': 'Jane', '$ Offer': '$5' },
          { 'Contact ID': '2', 'Owner Name': 'Bob', '$ Offer': '' },
        ],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.rowCount).toBe(2);
    // configured columns that ARE present (will be acted on):
    expect(result.presentColumns.sort()).toEqual(['$ Offer', 'Owner Name'].sort());
    // configured columns ABSENT from the file (left unchanged):
    expect(result.preservedColumns.sort()).toEqual(['County', 'Owner Name Aliases'].sort());
    expect(result.errors).toEqual([]);
  });

  it('blocks when the key column is absent', () => {
    const result = validateBulkCsv({
      operation: 'update',
      keyColumn: 'Contact ID',
      fields: UPDATE_FIELDS,
      parsed: { headers: ['Owner Name'], rows: [{ 'Owner Name': 'Jane' }] },
    });
    expect(result.ok).toBe(false);
    expect(result.missingRequiredColumns).toContain('Contact ID');
  });

  it('blocks when a row is missing its key value', () => {
    const result = validateBulkCsv({
      operation: 'update',
      keyColumn: 'Contact ID',
      fields: UPDATE_FIELDS,
      parsed: { headers: ['Contact ID', 'Owner Name'], rows: [{ 'Contact ID': '', 'Owner Name': 'Jane' }] },
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
});

describe('validateBulkCsv — create mode', () => {
  const CREATE_FIELDS: FieldSpec[] = [
    { column: 'Owner Name', field: 'FullName', strategy: 'replace', required: true },
    { column: '$ Offer', strategy: 'replace' },
  ];

  it('passes a valid create file (no key column required)', () => {
    const result = validateBulkCsv({
      operation: 'create',
      fields: CREATE_FIELDS,
      parsed: { headers: ['Owner Name', '$ Offer'], rows: [{ 'Owner Name': 'Jane', '$ Offer': '$5' }] },
    });
    expect(result.ok).toBe(true);
  });

  it('blocks when a required field column is absent', () => {
    const result = validateBulkCsv({
      operation: 'create',
      fields: CREATE_FIELDS,
      parsed: { headers: ['$ Offer'], rows: [{ '$ Offer': '$5' }] },
    });
    expect(result.ok).toBe(false);
    expect(result.missingRequiredColumns).toContain('Owner Name');
  });

  it('blocks when a required field value is blank in a row', () => {
    const result = validateBulkCsv({
      operation: 'create',
      fields: CREATE_FIELDS,
      parsed: { headers: ['Owner Name', '$ Offer'], rows: [{ 'Owner Name': '', '$ Offer': '$5' }] },
    });
    expect(result.ok).toBe(false);
    expect(result.rowsMissingRequiredValues).toEqual([{ rowNumber: 1, column: 'Owner Name' }]);
  });
});
