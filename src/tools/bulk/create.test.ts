import { describe, it, expect } from 'vitest';
import { buildCreateParams } from './create.js';
import type { CreateConfig } from './create.js';

describe('buildCreateParams', () => {
  it('sets the name (default field "Name") and IsCompany=false by default', () => {
    const config: CreateConfig = { nameColumn: 'Owner Name' };
    const params = buildCreateParams(config, { 'Owner Name': 'Jane Doe' });
    expect(params).toEqual({ Name: 'Jane Doe', IsCompany: false });
  });

  it('honors a custom name field and assignedTo default', () => {
    const config: CreateConfig = { nameColumn: 'Owner Name', nameField: 'FullName', assignedTo: '74874' };
    const params = buildCreateParams(config, { 'Owner Name': 'Jane Doe' });
    expect(params).toEqual({ FullName: 'Jane Doe', IsCompany: false, AssignedTo: '74874' });
  });

  it('builds a Phone array when present and omits it when blank', () => {
    const config: CreateConfig = { nameColumn: 'Owner Name', phone: { column: 'Phone Number', type: 'Home' } };
    expect(buildCreateParams(config, { 'Owner Name': 'J', 'Phone Number': '555-1212' }).Phone).toEqual([
      { Text: '555-1212', Type: 'Home' },
    ]);
    expect(buildCreateParams(config, { 'Owner Name': 'J', 'Phone Number': '' }).Phone).toBeUndefined();
  });

  it('builds an Email array (default type Work) when present', () => {
    const config: CreateConfig = { nameColumn: 'Owner Name', email: { column: 'Email' } };
    expect(buildCreateParams(config, { 'Owner Name': 'J', Email: 'j@x.com' }).Email).toEqual([
      { Text: 'j@x.com', Type: 'Work' },
    ]);
  });

  it('composes an address, joining two street lines with a newline (type defaults Home when set)', () => {
    const config: CreateConfig = {
      nameColumn: 'Owner Name',
      address: { street1: 'Addr1', street2: 'Addr2', city: 'City', state: 'State', zip: 'Zip', country: 'Country', type: 'Home' },
    };
    const params = buildCreateParams(config, {
      'Owner Name': 'J',
      Addr1: '123 Main',
      Addr2: 'Apt 4',
      City: 'Dallas',
      State: 'TX',
      Zip: '75001',
      Country: 'USA',
    });
    expect(params.Address).toEqual([
      { Street: '123 Main\nApt 4', City: 'Dallas', State: 'TX', Zip: '75001', Country: 'USA', Type: 'Home' },
    ]);
  });

  it('uses only the present street line when the other is blank', () => {
    const config: CreateConfig = { nameColumn: 'Owner Name', address: { street1: 'Addr1', street2: 'Addr2', city: 'City' } };
    const params = buildCreateParams(config, { 'Owner Name': 'J', Addr1: '123 Main', Addr2: '', City: 'Dallas' });
    expect(params.Address).toEqual([{ Street: '123 Main', City: 'Dallas', State: '', Zip: '', Country: '', Type: 'Work' }]);
  });

  it('omits the Address entirely when every address part is blank', () => {
    const config: CreateConfig = { nameColumn: 'Owner Name', address: { street1: 'Addr1', city: 'City' } };
    const params = buildCreateParams(config, { 'Owner Name': 'J', Addr1: '', City: '' });
    expect(params.Address).toBeUndefined();
  });

  it('sets scalar custom fields, skipping blank cells, honoring an explicit field key', () => {
    const config: CreateConfig = {
      nameColumn: 'Owner Name',
      customFields: [
        { column: '$ Offer' },
        { column: 'County' },
        { column: 'Owner Name', field: 'FullName' },
      ],
    };
    const params = buildCreateParams(config, { 'Owner Name': 'Jane', '$ Offer': '$1,000', County: '' });
    expect(params['$ Offer']).toBe('$1,000');
    expect(params.County).toBeUndefined(); // blank skipped
    expect(params.FullName).toBe('Jane');
  });
});
