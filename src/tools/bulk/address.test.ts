import { describe, it, expect } from 'vitest';
import { addressKey, isBlankAddress, buildAddressFromRow, mergeAddressIfAbsent, addressColumnList } from './address.js';

describe('addressKey — normalization (codifies $primaryaddress:282)', () => {
  it('is case-insensitive and whitespace/punctuation-insensitive', () => {
    expect(addressKey({ Street: '123 Main St.', City: 'Houston', State: 'TX', Zip: '77002' }))
      .toBe(addressKey({ Street: '123  main   st', City: 'HOUSTON', State: 'tx', Zip: '77002' }));
  });
  it('treats "St" and "Street" as the same (map, not drop)', () => {
    expect(addressKey({ Street: '123 Main St' })).toBe(addressKey({ Street: '123 Main Street' }));
  });
  it('keeps street TYPE distinct: "Main St" != "Main Ave"', () => {
    expect(addressKey({ Street: '123 Main St' })).not.toBe(addressKey({ Street: '123 Main Ave' }));
  });
  it('canonicalizes directionals: "N" == "North"', () => {
    expect(addressKey({ Street: '100 N Main St' })).toBe(addressKey({ Street: '100 North Main Street' }));
  });
  it('keeps the house number as a distinguisher: "100 Main" != "200 Main"', () => {
    expect(addressKey({ Street: '100 Main St' })).not.toBe(addressKey({ Street: '200 Main St' }));
  });
  it('normalizes ZIP+4 to the 5-digit base', () => {
    expect(addressKey({ Street: '1 A St', Zip: '77002-1234' })).toBe(addressKey({ Street: '1 A St', Zip: '77002' }));
  });
  it('treats a space-separated or run-together ZIP+4 the same as its 5-digit base', () => {
    expect(addressKey({ Street: '1 A St', Zip: '77002 1234' })).toBe(addressKey({ Street: '1 A St', Zip: '77002' }));
    expect(addressKey({ Street: '1 A St', Zip: '770021234' })).toBe(addressKey({ Street: '1 A St', Zip: '77002' }));
  });
  it('keeps distinct international postal codes distinct (no 5-char over-truncation)', () => {
    // Canadian codes share a 5-char prefix but differ in the 6th char — must NOT collapse.
    expect(addressKey({ Street: '1 A St', Zip: 'K1A 0B1' })).not.toBe(addressKey({ Street: '1 A St', Zip: 'K1A 0B9' }));
  });
  it('compares international postal codes case- and space-insensitively', () => {
    expect(addressKey({ Street: '1 A St', Zip: 'K1A 0B1' })).toBe(addressKey({ Street: '1 A St', Zip: 'k1a0b1' }));
  });
  it('canonicalizes a full state name to its 2-letter code', () => {
    expect(addressKey({ Street: '1 A St', State: 'Texas' })).toBe(addressKey({ Street: '1 A St', State: 'TX' }));
  });
  it('different city makes addresses distinct', () => {
    expect(addressKey({ Street: '1 A St', City: 'Houston' })).not.toBe(addressKey({ Street: '1 A St', City: 'Dallas' }));
  });
});

describe('isBlankAddress', () => {
  it('true when Street/City/State/Zip all empty (Type/Country alone do not count)', () => {
    expect(isBlankAddress({ Country: 'USA', Type: 'Work' })).toBe(true);
  });
  it('false when any of Street/City/State/Zip present', () => {
    expect(isBlankAddress({ City: 'Houston' })).toBe(false);
  });
});

describe('buildAddressFromRow', () => {
  it('joins street1 + street2 with a newline and applies the Type default', () => {
    const addr = buildAddressFromRow(
      { street1: 'Address Line 1', street2: 'Address Line 2', city: 'City', state: 'State', zip: 'Zip', type: 'Home' },
      { 'Address Line 1': '123 Main St', 'Address Line 2': 'Apt 4', 'City': 'Houston', 'State': 'TX', 'Zip': '77002' },
    );
    expect(addr).toEqual({ Street: '123 Main St\nApt 4', City: 'Houston', State: 'TX', Zip: '77002', Country: '', Type: 'Home' });
  });
  it('defaults Type to Work', () => {
    const addr = buildAddressFromRow({ street1: 'S' }, { 'S': '1 A St' });
    expect(addr.Type).toBe('Work');
  });
});

describe('mergeAddressIfAbsent — append-only, CRM copy wins on a duplicate', () => {
  const existing = [
    { Street: '123 MAIN ST', City: 'HOUSTON', State: 'TX', Zip: '77002', Country: '', Type: 'Work' },
    { Street: '500 OAK AVE', City: 'DALLAS', State: 'TX', Zip: '75201', Country: '', Type: 'Home' },
  ];

  it('appends a genuinely new address at the END', () => {
    const cand = { Street: '900 Elm Dr', City: 'Austin', State: 'TX', Zip: '78701', Country: '', Type: 'Work' };
    const r = mergeAddressIfAbsent(existing, cand);
    expect(r.changed).toBe(true);
    expect(r.addresses).toHaveLength(3);
    expect(r.addresses[2]).toEqual(cand);
    expect(r.addresses[0]).toBe(existing[0]); // existing objects preserved by reference (byte-for-byte)
  });

  it('skips an exact duplicate (keeps CRM copy, discards file version)', () => {
    const cand = { Street: '123 Main Street', City: 'houston', State: 'Texas', Zip: '77002-9999', Type: 'Home' };
    const r = mergeAddressIfAbsent(existing, cand);
    expect(r.changed).toBe(false);
    expect(r.addresses).toBe(existing); // unchanged array identity
  });

  it('skips a formatting-variant duplicate of a lower-position address', () => {
    const cand = { Street: '500 oak avenue', City: 'DALLAS', State: 'tx', Zip: '75201' };
    expect(mergeAddressIfAbsent(existing, cand).changed).toBe(false);
  });

  it('treats a blank candidate as no-op', () => {
    expect(mergeAddressIfAbsent(existing, { Type: 'Work' }).changed).toBe(false);
  });

  it('appends as the first/primary address when the contact has none', () => {
    const cand = { Street: '1 A St', City: 'Houston', State: 'TX', Zip: '77002', Country: '', Type: 'Work' };
    const r = mergeAddressIfAbsent([], cand);
    expect(r.changed).toBe(true);
    expect(r.addresses).toEqual([cand]);
  });
});

describe('addressColumnList', () => {
  it('returns the ordered, present column names (type is a literal, not a column)', () => {
    expect(addressColumnList({ street1: 'Address Line 1', street2: 'Address Line 2', city: 'City', state: 'State', zip: 'Zip', country: 'Country', type: 'Home' }))
      .toEqual(['Address Line 1', 'Address Line 2', 'City', 'State', 'Zip', 'Country']);
  });
});
