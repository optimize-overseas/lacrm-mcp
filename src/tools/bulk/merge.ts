/**
 * The merge engine for bulk update operations.
 *
 * Implements the column-presence + per-field-strategy model (see {@link MergeStrategy}).
 * It produces the field params to send to LACRM `EditContact` for a single row. Any
 * field it does NOT include is left unchanged by LACRM (that is how "preserve" works).
 *
 * Pure and instance-agnostic: all behavior is driven by the caller-supplied FieldSpec[].
 *
 * @module tools/bulk/merge
 */

import type { FieldSpec } from './types.js';
import { mergeAddressIfAbsent, buildAddressFromRow, type AddressColumnMapping, type AddressObject } from './address.js';

/** Default separator used to join union-merged list values. */
export const DEFAULT_JOIN_SEPARATOR = '; ';

export interface ComputeUpdateParamsInput {
  /** Field configuration for the operation. */
  fields: FieldSpec[];
  /** Column names actually present in the uploaded CSV header row. */
  presentColumns: string[];
  /** This row's cell values, keyed by CSV column name. */
  row: Record<string, string>;
  /** The existing LACRM contact (GetContact result), used for union merges. */
  existing: Record<string, unknown>;
  /** Optional structured-address mapping; when set, the uploaded address is appended if absent. */
  addressConfig?: AddressColumnMapping;
}

/** Split a semicolon-delimited value into trimmed, non-empty fragments. */
function splitList(value: string): string[] {
  return value
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Union-merge a new value into an existing one: new fragments first, then existing
 * fragments not already present, de-duplicated, joined with `separator`.
 */
function unionMerge(existingValue: unknown, newValue: string, separator: string): string {
  const newParts = splitList(newValue);
  const existingParts = splitList(typeof existingValue === 'string' ? existingValue : '');
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const part of [...newParts, ...existingParts]) {
    if (!seen.has(part)) {
      seen.add(part);
      merged.push(part);
    }
  }
  return merged.join(separator);
}

/**
 * Compute the EditContact field params for one row.
 *
 * @returns an object of `{ <lacrmFieldKey>: value }` containing ONLY the fields to
 *          write. Fields to preserve are omitted. `ContactId` is the caller's concern.
 */
export function computeUpdateParams(input: ComputeUpdateParamsInput): Record<string, unknown> {
  const present = new Set(input.presentColumns);
  const params: Record<string, unknown> = {};

  for (const spec of input.fields) {
    // never_write is always preserved; an absent column is preserved for every strategy.
    if (spec.strategy === 'never_write') continue;
    if (!present.has(spec.column)) continue;

    const targetKey = spec.field ?? spec.column;
    const value = (input.row[spec.column] ?? '').trim();

    switch (spec.strategy) {
      case 'replace':
        // Present column always written; a blank value clears the field.
        params[targetKey] = value;
        break;
      case 'preserve_if_blank':
        if (value !== '') params[targetKey] = value;
        break;
      case 'union_semicolon':
        if (value !== '') {
          params[targetKey] = unionMerge(input.existing[targetKey], value, spec.separator ?? DEFAULT_JOIN_SEPARATOR);
        }
        break;
    }
  }

  // Structured-address append-if-absent (update mode). The uploaded address is added
  // only when it is not already on the contact; on a duplicate the CRM copy is kept and
  // the file's version discarded. EditContact replaces the whole Address array, so we
  // emit the COMPLETE merged array (existing entries carried verbatim, new one appended).
  if (input.addressConfig) {
    const existingRaw = (input.existing as Record<string, unknown>).Address;
    const existingAddresses = (Array.isArray(existingRaw) ? existingRaw : []) as AddressObject[];
    const candidate = buildAddressFromRow(input.addressConfig, input.row);
    const merged = mergeAddressIfAbsent(existingAddresses, candidate);
    if (merged.changed) params.Address = merged.addresses;
  }

  return params;
}
