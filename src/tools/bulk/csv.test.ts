import { describe, it, expect } from 'vitest';
import { parseCsv, csvField, csvRow } from './csv.js';

describe('parseCsv', () => {
  it('parses a header row and returns rows keyed by header', () => {
    const { headers, rows } = parseCsv('Contact ID,Status\n123,active\n456,pending\n');
    expect(headers).toEqual(['Contact ID', 'Status']);
    expect(rows).toEqual([
      { 'Contact ID': '123', 'Status': 'active' },
      { 'Contact ID': '456', 'Status': 'pending' },
    ]);
  });

  it('handles quoted fields that contain commas', () => {
    const { rows } = parseCsv('Full Name,City\n"Smith, Robert",Dallas\n');
    expect(rows[0]).toEqual({ 'Full Name': 'Smith, Robert', City: 'Dallas' });
  });

  it('handles escaped (doubled) quotes inside a quoted field', () => {
    const { rows } = parseCsv('Note\n"He said ""hi"""\n');
    expect(rows[0]).toEqual({ Note: 'He said "hi"' });
  });

  it('strips a UTF-8 BOM from the first header (Excel exports)', () => {
    const { headers } = parseCsv('﻿Contact ID,City\n1,Dallas\n');
    expect(headers).toEqual(['Contact ID', 'City']);
  });

  it('trims surrounding whitespace from headers and values', () => {
    const { headers, rows } = parseCsv(' Contact ID , City \n 1 , Dallas \n');
    expect(headers).toEqual(['Contact ID', 'City']);
    expect(rows[0]).toEqual({ 'Contact ID': '1', City: 'Dallas' });
  });

  it('skips fully empty lines', () => {
    const { rows } = parseCsv('Contact ID\n1\n\n2\n');
    expect(rows).toEqual([{ 'Contact ID': '1' }, { 'Contact ID': '2' }]);
  });

  it('returns no rows for a header-only file', () => {
    const { headers, rows } = parseCsv('Contact ID,Status\n');
    expect(headers).toEqual(['Contact ID', 'Status']);
    expect(rows).toEqual([]);
  });

  it('tolerates rows with fewer columns than the header', () => {
    const { rows } = parseCsv('Contact ID,City,State\n1,Dallas\n');
    expect(rows[0]['Contact ID']).toBe('1');
    expect(rows[0].City).toBe('Dallas');
  });
});

describe('csvField (RFC-4180 escaping)', () => {
  it('leaves a plain value unquoted', () => {
    expect(csvField('Dallas')).toBe('Dallas');
  });
  it('quotes a value containing a comma', () => {
    expect(csvField('Smith, Robert')).toBe('"Smith, Robert"');
  });
  it('quotes and doubles internal quotes', () => {
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
  });
  it('quotes a value containing a newline', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
  it('does not quote a value containing only a semicolon', () => {
    expect(csvField('a; b')).toBe('a; b');
  });
});

describe('csvRow', () => {
  it('escapes each field and joins with commas', () => {
    expect(csvRow(['1', 'Smith, Robert', 'ok'])).toBe('1,"Smith, Robert",ok');
  });
});
