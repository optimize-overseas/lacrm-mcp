import { describe, it, expect } from 'vitest';
import { generateTemplate } from './template.js';
import type { FieldSpec } from './types.js';

const UPDATE_FIELDS: FieldSpec[] = [
  { column: 'Status', strategy: 'replace', example: 'active, verified', description: 'Account status' },
  { column: 'Tags', strategy: 'union_semicolon', example: 'vip; lead' },
  { column: 'Legacy ID', strategy: 'preserve_if_blank' },
  { column: 'Created Date', strategy: 'never_write' },
];

describe('generateTemplate — update mode', () => {
  it('puts the key column first, then field columns, excluding never_write fields', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    expect(t.columns).toEqual(['Contact ID', 'Status', 'Tags', 'Legacy ID']);
  });

  it('produces a header-only CSV by default (single line)', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    expect(t.csv).toBe('Contact ID,Status,Tags,Legacy ID');
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
    const status = t.report.find((r) => r.column === 'Status')!;
    expect(status.strategy).toBe('replace');
    expect(status.behavior.toLowerCase()).toContain('blank');
    expect(status.behavior.toLowerCase()).toContain('clear');
    expect(status.behavior.toLowerCase()).toContain('omit');
    expect(status.description).toBe('Account status');
  });

  it('explains accumulate (union) behavior: added and de-duplicated, never cleared', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    const tags = t.report.find((r) => r.column === 'Tags')!;
    expect(tags.strategy).toBe('union_semicolon');
    expect(tags.behavior.toLowerCase()).toContain('add');
  });

  it('lists never_write fields in the report (as locked) but not in the fillable columns', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS });
    expect(t.columns).not.toContain('Created Date');
    const created = t.report.find((r) => r.column === 'Created Date')!;
    expect(created.strategy).toBe('never_write');
    expect(created.behavior.toLowerCase()).toContain('never');
  });

  it('adds one example row when requested', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS, includeExampleRow: true });
    const lines = t.csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Contact ID,Status,Tags,Legacy ID');
    // example values come from each field's `example`; key + missing examples are blank.
    // "active, verified" is quoted (contains a comma); the semicolon list is not (semicolons need no quoting).
    expect(lines[1]).toBe(',"active, verified",vip; lead,');
  });

  it('appends address columns after fields with append-if-absent behavior', () => {
    const t = generateTemplate({ operation: 'update', keyColumn: 'Contact ID', fields: UPDATE_FIELDS, addressColumns: ['Address Line 1', 'City', 'State', 'Zip'] });
    expect(t.columns).toEqual(['Contact ID', 'Status', 'Tags', 'Legacy ID', 'Address Line 1', 'City', 'State', 'Zip']);
    const city = t.report.find((r) => r.column === 'City')!;
    expect(city.behavior.toLowerCase()).toContain('appended');
    expect(city.behavior.toLowerCase()).toContain('not already on the record');
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
    { column: 'Full Name', strategy: 'replace', required: true },
    { column: 'Status', strategy: 'replace' },
  ];

  it('has no key column and marks required fields', () => {
    const t = generateTemplate({ operation: 'create', fields: CREATE_FIELDS });
    expect(t.columns).toEqual(['Full Name', 'Status']);
    const name = t.report.find((r) => r.column === 'Full Name')!;
    expect(name.required).toBe(true);
    expect(name.behavior.toLowerCase()).toContain('required');
  });

  it('describes create behavior as setting values on a new contact', () => {
    const t = generateTemplate({ operation: 'create', fields: CREATE_FIELDS });
    const status = t.report.find((r) => r.column === 'Status')!;
    expect(status.behavior.toLowerCase()).toContain('new contact');
  });
});
