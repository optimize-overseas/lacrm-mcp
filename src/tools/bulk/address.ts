/**
 * Address normalization, equality, and append-if-absent merge for bulk UPDATE.
 *
 * Two addresses are considered the same when their Street/City/State/Zip match after
 * case-, whitespace-, and punctuation-insensitive normalization (e.g. "St" ≈ "Street",
 * "N" ≈ "North", a full state name ≈ its 2-letter code). The matcher is deliberately
 * tuned for PRECISION — when in doubt it treats the address as NEW and appends it, so it
 * never silently suppresses a legitimately-new address.
 *
 * It MAPS street suffixes / directionals to a canonical form and KEEPS them — along with
 * the house number and zip — as distinguishers (so "100 Main St" ≠ "100 Main Ave" and
 * "100 Main" ≠ "200 Main"). It is intentionally NOT a loose person/owner matcher that
 * would drop those tokens and over-merge distinct addresses.
 *
 * Generic and instance-agnostic — no specific CRM's fields, defaults, or use cases.
 *
 * @module tools/bulk/address
 */

import { cell } from './csv.js';

/** A LACRM address object. Extra keys (e.g. TypeId) on existing addresses are preserved. */
export interface AddressObject {
  Street?: string;
  City?: string;
  State?: string;
  Zip?: string;
  Country?: string;
  Type?: string;
  [k: string]: unknown;
}

/**
 * CSV-column → address mapping. `street1..country` are CSV COLUMN names; `type` is a
 * LITERAL category label (default 'Work'), not a column. Mirrors the create path.
 */
export interface AddressColumnMapping {
  street1: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  type?: string;
}

/** Verbose street-suffix → canonical USPS abbreviation. Short forms are already canonical (kept as-is). */
const STREET_SUFFIX_MAP: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', ROAD: 'RD', LANE: 'LN',
  COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', PARKWAY: 'PKWY', HIGHWAY: 'HWY', TERRACE: 'TER',
  TRAIL: 'TRL', SQUARE: 'SQ', PIKE: 'PIKE', PASS: 'PASS', COVE: 'CV', POINT: 'PT',
  CROSSING: 'XING', EXPRESSWAY: 'EXPY', FREEWAY: 'FWY', BEND: 'BND', PATH: 'PATH',
};

/** Verbose directional → canonical abbreviation. */
const DIRECTIONAL_MAP: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW',
};

/** Verbose unit designator → canonical abbreviation. */
const UNIT_MAP: Record<string, string> = {
  APARTMENT: 'APT', SUITE: 'STE', BUILDING: 'BLDG', FLOOR: 'FL', DEPARTMENT: 'DEPT', ROOM: 'RM',
};

/** Full US state name → 2-letter USPS code. */
const STATE_MAP: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO',
  CONNECTICUT: 'CT', DELAWARE: 'DE', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID',
  ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA',
  MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR',
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
};

/** Uppercase, replace every non-alphanumeric char with a space, collapse whitespace, trim. */
function squash(value: string): string {
  return (value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a street: squash, then map each token through suffix/directional/unit canon. */
function normalizeStreet(street: string | undefined): string {
  const squashed = squash(street ?? '');
  if (!squashed) return '';
  return squashed
    .split(' ')
    .map((tok) => STREET_SUFFIX_MAP[tok] ?? DIRECTIONAL_MAP[tok] ?? UNIT_MAP[tok] ?? tok)
    .join(' ');
}

/** Normalize a state: squash, then map a full name to its 2-letter code. */
function normalizeState(state: string | undefined): string {
  const squashed = squash(state ?? '');
  return STATE_MAP[squashed] ?? squashed;
}

/**
 * Canonicalize a postal code for comparison: strip any "-####" extension and inner
 * whitespace. A purely-numeric base (a US ZIP, or a ZIP+4 written without the dash) is
 * truncated to its 5-digit core so "77002", "77002-1234", and "770021234" all match.
 * A non-numeric base (an international postal code) is kept WHOLE and upper-cased, so
 * two genuinely-different codes (e.g. "K1A 0B1" vs "K1A 0B9") stay distinct rather than
 * collapsing — honoring the precision bias (never silently suppress a new address).
 */
function normalizeZip(zip: string | undefined): string {
  const trimmed = (zip ?? '').trim();
  const withoutExtension = trimmed.includes('-') ? trimmed.slice(0, trimmed.indexOf('-')) : trimmed;
  const base = withoutExtension.replace(/\s+/g, '');
  return /^\d+$/.test(base) ? base.slice(0, 5) : base.toUpperCase();
}

/** The content-equality key for an address (Street/City/State/Zip; Type & Country excluded). */
export function addressKey(addr: AddressObject): string {
  return [normalizeStreet(addr.Street), squash(addr.City ?? ''), normalizeState(addr.State), normalizeZip(addr.Zip)].join('|');
}

/** An address is blank when Street, City, State, and Zip are all empty. */
export function isBlankAddress(addr: AddressObject): boolean {
  return !(`${addr.Street ?? ''}`.trim() || `${addr.City ?? ''}`.trim() || `${addr.State ?? ''}`.trim() || `${addr.Zip ?? ''}`.trim());
}

/** Build a clean AddressObject from one CSV row using the column mapping. */
export function buildAddressFromRow(config: AddressColumnMapping, row: Record<string, string>): AddressObject {
  const line1 = cell(row, config.street1);
  const line2 = cell(row, config.street2);
  const street = line1 && line2 ? `${line1}\n${line2}` : line1 || line2;
  return {
    Street: street,
    City: cell(row, config.city),
    State: cell(row, config.state),
    Zip: cell(row, config.zip),
    Country: cell(row, config.country),
    Type: config.type ?? 'Work',
  };
}

export interface AddressMergeResult {
  changed: boolean;
  addresses: AddressObject[];
}

/**
 * Append `candidate` to `existing` only if its content-key is not already present.
 * On a duplicate the existing array is returned unchanged (CRM copy wins; file version
 * discarded). Existing objects are carried by reference — never mutated or reordered.
 */
export function mergeAddressIfAbsent(existing: AddressObject[], candidate: AddressObject): AddressMergeResult {
  if (isBlankAddress(candidate)) return { changed: false, addresses: existing };
  const candKey = addressKey(candidate);
  for (const addr of existing) {
    if (addressKey(addr) === candKey) return { changed: false, addresses: existing };
  }
  return { changed: true, addresses: [...existing, candidate] };
}

/** Ordered, de-duplicated list of CSV COLUMN names referenced by the mapping (excludes the literal `type`). */
export function addressColumnList(config: AddressColumnMapping): string[] {
  const cols = [config.street1, config.street2, config.city, config.state, config.zip, config.country];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cols) {
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}
