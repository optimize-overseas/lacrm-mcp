import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { redactSecrets, debugParams, debugFileMeta } from './redact.js';

// All token-shaped strings below are SYNTHETIC, not real credentials.

describe('redactSecrets', () => {
  it('masks an Asana PAT, a Lob key, a Bearer token, and a keyed secret value', () => {
    // Assembled from fragments so no contiguous token literal exists in source
    // (avoids GitHub push-protection / secret-scanner false positives).
    const asana = '1/1201234567890123' + ':' + 'abcdef0123456789abcdef0123456789';
    expect(redactSecrets(`tok ${asana}`)).toBe('tok [REDACTED_ASANA_TOKEN]');
    expect(redactSecrets('live_9f1c2b3a4d5e6f70819a2b3c4d5e6f7081ab')).toBe('[REDACTED_KEY]');
    expect(redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payloadpart.sigpart123'))
      .toContain('Bearer [REDACTED_TOKEN]');
    expect(redactSecrets('api_key=abcdef1234567890XYZ0')).toBe('api_key=[REDACTED]');
  });

  it('masks lowercase bearer, PEM keys, and bare provider prefixes (review I-1/I-2/I-3)', () => {
    expect(redactSecrets('authorization: bearer eyJhbGciOiJIUzI1NiJ9.body.sigsigsig123')).toContain('Bearer [REDACTED_TOKEN]');
    expect(redactSecrets('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANexample\n-----END PRIVATE KEY-----')).toBe('[REDACTED_PRIVATE_KEY]');
    expect(redactSecrets('sk-' + 'ant-api03-AbCdEf012345_6789-ghIJKlmnop')).toBe('[REDACTED_KEY]');
  });

  it('leaves ordinary CRM content (names, addresses) untouched', () => {
    const s = 'John Smith, 123 Main St, Anytown';
    expect(redactSecrets(s)).toBe(s);
  });
});

describe('debugParams — default is keys-only (no PII/secret values)', () => {
  const savedFlag = process.env.LACRM_DEBUG_PARAMS;
  beforeEach(() => { delete process.env.LACRM_DEBUG_PARAMS; });
  afterEach(() => { if (savedFlag === undefined) delete process.env.LACRM_DEBUG_PARAMS; else process.env.LACRM_DEBUG_PARAMS = savedFlag; });

  it('returns only the parameter KEYS, never the values, by default', () => {
    const params = { ContactId: '86441', Name: 'Jane Q. Public', Notes: 'private client note' };
    const out = debugParams(params);
    const s = JSON.stringify(out);
    expect(s).toContain('ContactId');
    expect(s).toContain('Notes');
    expect(s).not.toContain('Jane Q. Public');
    expect(s).not.toContain('private client note');
    expect(s).not.toContain('86441');
  });
});

describe('debugParams — explicit opt-in logs values but still masks secrets', () => {
  const savedFlag = process.env.LACRM_DEBUG_PARAMS;
  beforeEach(() => { process.env.LACRM_DEBUG_PARAMS = '1'; });
  afterEach(() => { if (savedFlag === undefined) delete process.env.LACRM_DEBUG_PARAMS; else process.env.LACRM_DEBUG_PARAMS = savedFlag; });

  it('shows PII values (operator opted in) but redacts token-shaped values, even nested', () => {
    const params = { Name: 'Jane Q. Public', auth: 'Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbbbbbbbbbbb', nested: { key: 'live_9f1c2b3a4d5e6f70819a2b3c4d5e6f7081ab' } };
    const s = JSON.stringify(debugParams(params));
    expect(s).toContain('Jane Q. Public');            // PII visible under explicit opt-in
    expect(s).not.toContain('eyJhbGciOiJIUzI1NiJ9');   // secret masked
    expect(s).toContain('[REDACTED_TOKEN]');
    expect(s).not.toContain('live_9f1c2b3a4d5e6f70819a2b3c4d5e6f7081ab'); // nested secret masked
  });
});

describe('debugFileMeta', () => {
  const savedFlag = process.env.LACRM_DEBUG_PARAMS;
  afterEach(() => { if (savedFlag === undefined) delete process.env.LACRM_DEBUG_PARAMS; else process.env.LACRM_DEBUG_PARAMS = savedFlag; });

  it('omits the filename by default (it can be PII) but keeps size/mime', () => {
    delete process.env.LACRM_DEBUG_PARAMS;
    const out = debugFileMeta({ name: 'John Smith SSN card.pdf', content: new Uint8Array(10), mimeType: 'application/pdf' });
    const s = JSON.stringify(out);
    expect(s).not.toContain('John Smith SSN card.pdf');
    expect(s).toContain('application/pdf');
    expect(s).toContain('10');
  });

  it('includes the filename under explicit opt-in', () => {
    process.env.LACRM_DEBUG_PARAMS = '1';
    const out = debugFileMeta({ name: 'doc.pdf', content: new Uint8Array(3), mimeType: 'application/pdf' });
    expect(JSON.stringify(out)).toContain('doc.pdf');
  });
});
