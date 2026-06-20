import { describe, it, expect } from 'vitest';
import { generateTemplate } from './template.js';
import type { FieldSpec } from './types.js';

const UPDATE_FIELDS: FieldSpec[] = [
  { column: '$ Offer', strategy: 'replace', example: '$1,000', description: 'Latest offer amount' },
  { column: 'Owner Name Aliases', strategy: 'union_semicolon', example: 'Bob Smith; B. Smith' },
  { column: 'AA Contact ID', strategy: 'preserve_if_blank' },
  { column: 'Deceased Date', strategy: 'never_write' },
];

describe('generateTemplate — update mode', () => {
  it('puts the key column first, then field columns, excluding never_write fields', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    expect(t.columns).toEqual(['Contact ID', '$ Offer', 'Owner Name Aliases', 'AA Contact ID']);
  });

  it('produces a header-only CSV by default (single line)', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    expect(t.csv).toBe('Contact ID,$ Offer,Owner Name Aliases,AA Contact ID');
  });

  it('reports the key column as a required identifier', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    const key = t.report.find((r) => r.column === 'Contact ID')!;
    expect(key.required).toBe(true);
    expect(key.strategy).toBe('key');
    expect(key.behavior.toLowerCase()).toContain('required');
  });

  it('explains replace behavior: blank clears, omitted preserves', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    const offer = t.report.find((r) => r.column === '$ Offer')!;
    expect(offer.strategy).toBe('replace');
    expect(offer.behavior.toLowerCase()).toContain('blank');
    expect(offer.behavior.toLowerCase()).toContain('clear');
    expect(offer.behavior.toLowerCase()).toContain('omit');
    expect(offer.description).toBe('Latest offer amount');
  });

  it('explains accumulate (union) behavior: added and de-duplicated, never cleared', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    const aliases = t.report.find((r) => r.column === 'Owner Name Aliases')!;
    expect(aliases.strategy).toBe('union_semicolon');
    expect(aliases.behavior.toLowerCase()).toContain('add');
  });

  it('lists never_write fields in the report (as locked) but not in the fillable columns', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    expect(t.columns).not.toContain('Deceased Date');
    const deceased = t.report.find((r) => r.column === 'Deceased Date')!;
    expect(deceased.strategy).toBe('never_write');
    expect(deceased.behavior.toLowerCase()).toContain('never');
  });

  it('adds one example row when requested', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS, includeExampleRow: true });
    const lines = t.csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Contact ID,$ Offer,Owner Name Aliases,AA Contact ID');
    // example values come from each field's `example`; key + missing examples are blank.
    // "$1,000" is quoted (contains a comma); the semicolon list is not (semicolons need no quoting).
    expect(lines[1]).toBe(',"$1,000",Bob Smith; B. Smith,');
  });
});

describe('generateTemplate — CSV escaping', () => {
  it('quotes a header that contains a comma', () => {
    const t = generateTemplate({
      operation: 'create',
      fields: [{ column: 'Name, Full', strategy: 'replace' }],
    });
    expect(t.csv).toBe('"Name, Full"');
  });
});

describe('generateTemplate — create mode', () => {
  const CREATE_FIELDS: FieldSpec[] = [
    { column: 'Owner Name', strategy: 'replace', required: true },
    { column: '$ Offer', strategy: 'replace' },
  ];

  it('has no key column and marks required fields', () => {
    const t = generateTemplate({ operation: 'create', fields: CREATE_FIELDS });
    expect(t.columns).toEqual(['Owner Name', '$ Offer']);
    const name = t.report.find((r) => r.column === 'Owner Name')!;
    expect(name.required).toBe(true);
    expect(name.behavior.toLowerCase()).toContain('required');
  });

  it('describes create behavior as setting values on a new contact', () => {
    const t = generateTemplate({ operation: 'create', fields: CREATE_FIELDS });
    const offer = t.report.find((r) => r.column === '$ Offer')!;
    expect(offer.behavior.toLowerCase()).toContain('new contact');
  });
});
