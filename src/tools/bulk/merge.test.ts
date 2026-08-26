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
  const fields: FieldSpec[] = [{ column: 'Status', strategy: 'replace' }];

  it('writes the value when the column is present with a value', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['Status'], row: { 'Status': 'active' }, existing: {} });
    expect(params).toEqual({ 'Status': 'active' });
  });

  it('writes an empty string (CLEARS the field) when the column is present but blank', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['Status'], row: { 'Status': '' }, existing: { 'Status': 'active' } });
    expect(params).toEqual({ 'Status': '' });
  });

  it('omits the field (PRESERVES it) when the column is absent from the CSV', () => {
    const params = computeUpdateParams({ fields, presentColumns: [], row: {}, existing: { 'Status': 'active' } });
    expect(params).toEqual({});
  });

  it('trims surrounding whitespace from the value', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['Status'], row: { 'Status': '  active  ' }, existing: {} });
    expect(params).toEqual({ 'Status': 'active' });
  });

  it('treats a whitespace-only cell as blank (clears)', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['Status'], row: { 'Status': '   ' }, existing: { 'Status': 'x' } });
    expect(params).toEqual({ 'Status': '' });
  });
});

describe('computeUpdateParams — preserve_if_blank strategy (fill-only; blank never clears)', () => {
  const fields: FieldSpec[] = [{ column: 'Legacy ID', strategy: 'preserve_if_blank' }];

  it('writes the value when present with a value', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['Legacy ID'], row: { 'Legacy ID': '12345' }, existing: { 'Legacy ID': '99999' } });
    expect(params).toEqual({ 'Legacy ID': '12345' });
  });

  it('omits the field (preserves existing) when present but blank', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['Legacy ID'], row: { 'Legacy ID': '' }, existing: { 'Legacy ID': '99999' } });
    expect(params).toEqual({});
  });

  it('omits the field when the column is absent', () => {
    const params = computeUpdateParams({ fields, presentColumns: [], row: {}, existing: { 'Legacy ID': '99999' } });
    expect(params).toEqual({});
  });
});

describe('computeUpdateParams — union_semicolon strategy (accumulate; never clears)', () => {
  const fields: FieldSpec[] = [{ column: 'Tags', strategy: 'union_semicolon' }];

  it('merges new values ahead of existing ones, de-duplicated, joined with "; "', () => {
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Tags'],
      row: { 'Tags': 'vip; lead' },
      existing: { 'Tags': 'lead; west' },
    });
    expect(params).toEqual({ 'Tags': 'vip; lead; west' });
  });

  it('adds new tags to an empty existing value', () => {
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Tags'],
      row: { 'Tags': 'vip' },
      existing: {},
    });
    expect(params).toEqual({ 'Tags': 'vip' });
  });

  it('omits the field (preserves existing) when present but blank — never clears an accumulate field', () => {
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Tags'],
      row: { 'Tags': '' },
      existing: { 'Tags': 'lead' },
    });
    expect(params).toEqual({});
  });

  it('omits the field when the column is absent', () => {
    const params = computeUpdateParams({ fields, presentColumns: [], row: {}, existing: { 'Tags': 'lead' } });
    expect(params).toEqual({});
  });

  it('ignores empty fragments and stray whitespace inside the list', () => {
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Tags'],
      row: { 'Tags': ' vip ;; ' },
      existing: { 'Tags': '  lead ; ' },
    });
    expect(params).toEqual({ 'Tags': 'vip; lead' });
  });
});

describe('computeUpdateParams — never_write strategy (always preserved)', () => {
  const fields: FieldSpec[] = [{ column: 'Created Date', strategy: 'never_write' }];

  it('omits the field even when present with a value', () => {
    const params = computeUpdateParams({ fields, presentColumns: ['Created Date'], row: { 'Created Date': '2024-01-01' }, existing: {} });
    expect(params).toEqual({});
  });
});

describe('computeUpdateParams — field mapping and composition', () => {
  it('writes to a distinct LACRM field key when "field" differs from the CSV column', () => {
    const fields: FieldSpec[] = [{ column: 'Full Name', field: 'FullName', strategy: 'replace' }];
    const params = computeUpdateParams({ fields, presentColumns: ['Full Name'], row: { 'Full Name': 'Jane Doe' }, existing: {} });
    expect(params).toEqual({ FullName: 'Jane Doe' });
  });

  it('composes a realistic row across all strategies (present + blank value)', () => {
    const fields: FieldSpec[] = [
      { column: 'Full Name', field: 'FullName', strategy: 'replace' },
      { column: 'Last Contacted', strategy: 'replace' },
      { column: 'Status', strategy: 'replace' },
      { column: 'Tags', strategy: 'union_semicolon' },
      { column: 'Legacy ID', strategy: 'preserve_if_blank' },
      { column: 'Created Date', strategy: 'never_write' },
    ];
    const params = computeUpdateParams({
      fields,
      presentColumns: ['Full Name', 'Last Contacted', 'Status', 'Tags', 'Legacy ID', 'Created Date'],
      row: {
        'Full Name': 'Jane Doe',
        'Last Contacted': '2026-06-20',
        'Status': '', // present + blank -> CLEAR the stale value
        'Tags': '',
        'Legacy ID': '',
        'Created Date': '2024-01-01',
      },
      existing: { 'Status': 'active', 'Tags': 'west', 'Legacy ID': '777', 'Created Date': '' },
    });
    // FullName + date written; Status cleared; tags/Legacy ID preserved (omitted); created date never written.
    expect(params).toEqual({
      FullName: 'Jane Doe',
      'Last Contacted': '2026-06-20',
      'Status': '',
    });
  });
});

describe('computeUpdateParams — address append-if-absent', () => {
  const addressConfig = { street1: 'Street', city: 'City', state: 'State', zip: 'Zip', type: 'Work' };
  const existing = { Address: [{ Street: '123 MAIN ST', City: 'HOUSTON', State: 'TX', Zip: '77002', Type: 'Work' }] };

  it('appends a new address as the full merged array', () => {
    const params = computeUpdateParams({
      fields: [], presentColumns: ['Street', 'City', 'State', 'Zip'],
      row: { Street: '900 Elm Dr', City: 'Austin', State: 'TX', Zip: '78701' },
      existing, addressConfig,
    });
    expect((params.Address as any[])).toHaveLength(2);
    expect((params.Address as any[])[1].Street).toBe('900 Elm Dr');
  });

  it('omits Address entirely when the uploaded address duplicates an existing one', () => {
    const params = computeUpdateParams({
      fields: [], presentColumns: ['Street', 'City', 'State', 'Zip'],
      row: { Street: '123 Main Street', City: 'houston', State: 'Texas', Zip: '77002-1' },
      existing, addressConfig,
    });
    expect(params.Address).toBeUndefined();
  });

  it('omits Address when no address config is supplied', () => {
    const params = computeUpdateParams({ fields: [], presentColumns: ['Street'], row: { Street: 'x' }, existing });
    expect(params.Address).toBeUndefined();
  });

  it('composes a flat-field update AND an address append in one row', () => {
    const params = computeUpdateParams({
      fields: [{ column: 'Deal Value', strategy: 'preserve_if_blank' }],
      presentColumns: ['Deal Value', 'Street', 'City', 'State', 'Zip'],
      row: { 'Deal Value': '5000', Street: '900 Elm Dr', City: 'Austin', State: 'TX', Zip: '78701' },
      existing, addressConfig,
    });
    expect(params['Deal Value']).toBe('5000');
    expect((params.Address as any[])).toHaveLength(2);
  });
});
