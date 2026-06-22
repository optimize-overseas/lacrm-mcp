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

import { buildAddressFromRow, type AddressColumnMapping } from './address.js';
import { cell } from './csv.js';

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
    const addr = buildAddressFromRow(config.address, row);
    // Create mode emits the address only when some part is set (Country counts here);
    // a new contact has nothing to preserve, so an all-blank address is simply skipped.
    if (addr.Street || addr.City || addr.State || addr.Zip || addr.Country) {
      params.Address = [addr];
    }
  }

  for (const cf of config.customFields ?? []) {
    const value = cell(row, cf.column);
    if (value !== '') params[cf.field ?? cf.column] = value;
  }

  return params;
}
