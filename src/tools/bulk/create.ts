/**
 * Create-mode (new contacts) parameter builder.
 *
 * Pure and instance-agnostic. Builds the LACRM `CreateContact` params for one row
 * from a caller-supplied mapping that mirrors the structure the existing
 * `create_contact` tool uses (Name / AssignedTo / IsCompany / Phone[] / Email[] /
 * Address[] / scalar custom fields). There is no merge in create mode: values are
 * set, and blank cells are omitted (a new contact has nothing to preserve or clear).
 *
 * @module tools/bulk/create
 */

import type { AddressColumnMapping } from './address.js';

/** @deprecated Use {@link AddressColumnMapping}. Retained as an alias for back-compat. */
export type CreateAddressMapping = AddressColumnMapping;

export interface CreateConfig {
  /** CSV column holding the contact's name. */
  nameColumn: string;
  /** LACRM field key for the name. Default 'Name'. */
  nameField?: string;
  /** User ID to assign new contacts to (caller default). */
  assignedTo?: string;
  /** Create a company instead of a person. Default false. */
  isCompany?: boolean;
  phone?: { column: string; type?: string };
  email?: { column: string; type?: string };
  address?: AddressColumnMapping;
  /** Scalar custom/standard fields set directly; blank cells are skipped. */
  customFields?: { column: string; field?: string }[];
}

function cell(row: Record<string, string>, column: string | undefined): string {
  if (!column) return '';
  return (row[column] ?? '').trim();
}

export function buildCreateParams(config: CreateConfig, row: Record<string, string>): Record<string, unknown> {
  const params: Record<string, unknown> = {
    [config.nameField ?? 'Name']: cell(row, config.nameColumn),
    IsCompany: config.isCompany ?? false,
  };
  if (config.assignedTo) params.AssignedTo = config.assignedTo;

  if (config.phone) {
    const value = cell(row, config.phone.column);
    if (value) params.Phone = [{ Text: value, Type: config.phone.type ?? 'Work' }];
  }

  if (config.email) {
    const value = cell(row, config.email.column);
    if (value) params.Email = [{ Text: value, Type: config.email.type ?? 'Work' }];
  }

  if (config.address) {
    const line1 = cell(row, config.address.street1);
    const line2 = cell(row, config.address.street2);
    const street = line1 && line2 ? `${line1}\n${line2}` : line1 || line2;
    const city = cell(row, config.address.city);
    const state = cell(row, config.address.state);
    const zip = cell(row, config.address.zip);
    const country = cell(row, config.address.country);
    if (street || city || state || zip || country) {
      params.Address = [
        { Street: street, City: city, State: state, Zip: zip, Country: country, Type: config.address.type ?? 'Work' },
      ];
    }
  }

  for (const cf of config.customFields ?? []) {
    const value = cell(row, cf.column);
    if (value !== '') params[cf.field ?? cf.column] = value;
  }

  return params;
}
