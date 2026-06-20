import { describe, it, expect } from 'vitest';
import { computeUpdateParams } from './merge.js';
import type { FieldSpec } from './types.js';

/**
 * The merge engine implements the column-presence + per-field-strategy model:
 *
 *   - Column ABSENT from the uploaded CSV  -> field omitted (LACRM leaves it unchanged) for EVERY strategy.
 *   - Column PRESENT -> behavior depends on the field's strategy:
 *       replace            : value written (blank cell CLEARS the field)
 *       preserve_if_blank  : value written; blank cell ignored (existing value kept)
 *       union_semicolon    : value union-merged with the existing value; blank ignored
 *       never_write        : always omitted
 *
 * "Omit" relies on LACRM EditContact semantics: a field not included in the params is left unchanged.
 */
describe('computeUpdateParams — replace strategy (default; blank clears)', () => {
  const fields: FieldSpec[] = [{ column: '$ Offer', strategy: 'replace' }];

  it('writes the value when the column is present with a value', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['$ Offer'], row: { '$ Offer': '$1,000' }, existing: {} });
    expect(params).toEqual({ '$ Offer': '$1,000' });
  });

  it('writes an empty string (CLEARS the field) when the column is present but blank', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['$ Offer'], row: { '$ Offer': '' }, existing: { '$ Offer': '$1,000' } });
    expect(params).toEqual({ '$ Offer': '' });
  });

  it('omits the field (PRESERVES it) when the column is absent from the CSV', () => {
    const params = computeUpdateParams({ fields, presentColumns: [], row: {}, existing: { '$ Offer': '$1,000' } });
    expect(params).toEqual({});
  });

  it('trims surrounding whitespace from the value', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['$ Offer'], row: { '$ Offer': '  $1,000  ' }, existing: {} });
    expect(params).toEqual({ '$ Offer': '$1,000' });
  });

  it('treats a whitespace-only cell as blank (clears)', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['$ Offer'], row: { '$ Offer': '   ' }, existing: { '$ Offer': 'x' } });
    expect(params).toEqual({ '$ Offer': '' });
  });
});

describe('computeUpdateParams — preserve_if_blank strategy (fill-only; blank never clears)', () => {
  const fields: FieldSpec[] = [{ column: 'AA Contact ID', strategy: 'preserve_if_blank' }];

  it('writes the value when present with a value', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['AA Contact ID'], row: { 'AA Contact ID': '12345' }, existing: { 'AA Contact ID': '99999' } });
    expect(params).toEqual({ 'AA Contact ID': '12345' });
  });

  it('omits the field (preserves existing) when present but blank', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['AA Contact ID'], row: { 'AA Contact ID': '' }, existing: { 'AA Contact ID': '99999' } });
    expect(params).toEqual({});
  });

  it('omits the field when the column is absent', () => {
    const params = computeUpdateParams({ fields, presentColumns: [], row: {}, existing: { 'AA Contact ID': '99999' } });
    expect(params).toEqual({});
  });
});

describe('computeUpdateParams — union_semicolon strategy (accumulate; never clears)', () => {
  const fields: FieldSpec[] = [{ column: 'Owner Name Aliases', strategy: 'union_semicolon' }];

  it('merges new values ahead of existing ones, de-duplicated, joined with "; "', () => {
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Owner Name Aliases'],
      row: { 'Owner Name Aliases': 'Bob Smith; Robert Smith' },
      existing: { 'Owner Name Aliases': 'Robert Smith; B. Smith' },
    });
    expect(params).toEqual({ 'Owner Name Aliases': 'Bob Smith; Robert Smith; B. Smith' });
  });

  it('adds new aliases to an empty existing value', () => {
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Owner Name Aliases'],
      row: { 'Owner Name Aliases': 'Bob Smith' },
      existing: {},
    });
    expect(params).toEqual({ 'Owner Name Aliases': 'Bob Smith' });
  });

  it('omits the field (preserves existing) when present but blank — never clears an accumulate field', () => {
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Owner Name Aliases'],
      row: { 'Owner Name Aliases': '' },
      existing: { 'Owner Name Aliases': 'Robert Smith' },
    });
    expect(params).toEqual({});
  });

  it('omits the field when the column is absent', () => {
    const params = computeUpdateParams({ fields, presentColumns: [], row: {}, existing: { 'Owner Name Aliases': 'Robert Smith' } });
    expect(params).toEqual({});
  });

  it('ignores empty fragments and stray whitespace inside the list', () => {
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Owner Name Aliases'],
      row: { 'Owner Name Aliases': ' Bob Smith ;; ' },
      existing: { 'Owner Name Aliases': '  Robert Smith ; ' },
    });
    expect(params).toEqual({ 'Owner Name Aliases': 'Bob Smith; Robert Smith' });
  });
});

describe('computeUpdateParams — never_write strategy (always preserved)', () => {
  const fields: FieldSpec[] = [{ column: 'Deceased Date', strategy: 'never_write' }];

  it('omits the field even when present with a value', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['Deceased Date'], row: { 'Deceased Date': '2024-01-01' }, existing: {} });
    expect(params).toEqual({});
  });
});

describe('computeUpdateParams — field mapping and composition', () => {
  it('writes to a distinct LACRM field key when "field" differs from the CSV column', () => {
    const fields: FieldSpec[] = [{ column: 'Owner Name', field: 'FullName', strategy: 'replace' }];
    const params = computeUpdateParams({ fields, presentColumns: ['Owner Name'], row: { 'Owner Name': 'Jane Doe' }, existing: {} });
    expect(params).toEqual({ FullName: 'Jane Doe' });
  });

  it('composes a realistic row across all strategies (latest letter, no offer)', () => {
    const fields: FieldSpec[] = [
      { column: 'Owner Name', field: 'FullName', strategy: 'replace' },
      { column: 'Date Of Letter Distribution', strategy: 'replace' },
      { column: '$ Offer', strategy: 'replace' },
      { column: 'Owner Name Aliases', strategy: 'union_semicolon' },
      { column: 'AA Contact ID', strategy: 'preserve_if_blank' },
      { column: 'Deceased Date', strategy: 'never_write' },
    ];
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Owner Name', 'Date Of Letter Distribution', '$ Offer', 'Owner Name Aliases', 'AA Contact ID', 'Deceased Date'],
      row: {
        'Owner Name': 'Jane Doe',
        'Date Of Letter Distribution': '2026-06-20',
        '$ Offer': '', // generic letter: no offer -> CLEAR the stale value
        'Owner Name Aliases': '',
        'AA Contact ID': '',
        'Deceased Date': '2024-01-01',
      },
      existing: { '$ Offer': '$1,000', 'Owner Name Aliases': 'J. Doe', 'AA Contact ID': '777', 'Deceased Date': '' },
    });
    // FullName + date written; $ Offer cleared; aliases/AA preserved (omitted); deceased never written.
    expect(params).toEqual({
      FullName: 'Jane Doe',
      'Date Of Letter Distribution': '2026-06-20',
      '$ Offer': '',
    });
  });
});
