import { describe, it, expect } from 'vitest';
import { resolveCustomFieldNames, resolveUserNames } from './resolve-names.js';

// Minimal client stub — resolve-names only needs `.call(functionName, params)`.
function mockClient(responses: Record<string, unknown>) {
  return { call: async (fn: string) => responses[fn] } as any;
}

describe('resolveCustomFieldNames — writes by NAME, parses wrapped responses', () => {
  const fields = [
    { CustomFieldId: '111', Name: 'Region', Type: 'Text' },
    { CustomFieldId: '222', Name: 'Status', Type: 'Dropdown', Options: ['Open', 'Closed'] },
  ];
  const wrapped = { HasMoreResults: false, Results: fields };

  it('parses the wrapped {Results} response and keys the output by NAME (not CustomFieldId)', async () => {
    const c = mockClient({ GetCustomFields: wrapped });
    const out = await resolveCustomFieldNames(c, { Region: 'West' }, 'Contact');
    expect(out).toEqual({ Region: 'West' }); // by NAME — the only shape v2 actually writes
    expect(out['111']).toBeUndefined(); // NOT by id (the historical bug)
  });

  it('also accepts a bare-array response', async () => {
    const c = mockClient({ GetCustomFields: fields });
    const out = await resolveCustomFieldNames(c, { Region: 'West' }, 'Contact');
    expect(out).toEqual({ Region: 'West' });
  });

  it('validates dropdown values against the field options', async () => {
    const c = mockClient({ GetCustomFields: wrapped });
    await expect(resolveCustomFieldNames(c, { Status: 'Nope' }, 'Contact')).rejects.toThrow(/Invalid value/);
    expect(await resolveCustomFieldNames(c, { Status: 'Open' }, 'Contact')).toEqual({ Status: 'Open' });
  });

  it('lists available fields when a name is unknown (regression: was empty when the response was wrapped)', async () => {
    const c = mockClient({ GetCustomFields: wrapped });
    await expect(resolveCustomFieldNames(c, { Nonexistent: 'x' }, 'Contact')).rejects.toThrow(/Region, Status/);
  });

  it('matches the field name case-insensitively and emits the canonical Name', async () => {
    const c = mockClient({ GetCustomFields: wrapped });
    const out = await resolveCustomFieldNames(c, { region: 'West' }, 'Contact');
    expect(out).toEqual({ Region: 'West' });
  });
});

describe('resolveUserNames — hardened parse', () => {
  const users = [
    { UserId: 'U1', FirstName: 'Jane', LastName: 'Doe' },
    { UserId: 'U2', FirstName: 'Bob', LastName: 'Roe' },
  ];
  it('parses a bare-array GetUsers', async () => {
    expect(await resolveUserNames(mockClient({ GetUsers: users }), ['Jane Doe'])).toEqual(['U1']);
  });
  it('also parses a wrapped {Users} response (future-proofing)', async () => {
    expect(await resolveUserNames(mockClient({ GetUsers: { Users: users } }), ['Bob'])).toEqual(['U2']);
  });
});
