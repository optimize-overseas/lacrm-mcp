/**
 * Name Resolution Utilities
 *
 * Resolves human-readable names (status names, user names, calendar names,
 * custom field names) to their corresponding CRM IDs by querying the API.
 *
 * All lookups are case-insensitive. If any name cannot be resolved, an error
 * is thrown listing both the unmatched names and the available options.
 *
 * @module utils/resolve-names
 */

import type { LacrmClient } from '../client.js';

interface StatusInfo {
  StatusId: string;
  Name: string;
}

interface UserInfo {
  UserId: string;
  FirstName: string;
  LastName: string;
}

interface CalendarInfo {
  CalendarId: string;
  Name: string;
}

interface CustomFieldInfo {
  CustomFieldId: string;
  Name: string;
  Options?: string[];
}

/**
 * Resolve pipeline status names to their IDs.
 *
 * @param client - LACRM API client
 * @param pipelineId - Pipeline ID to look up statuses for
 * @param names - Array of status names to resolve (case-insensitive)
 * @returns Array of resolved StatusId values
 * @throws Error if any name cannot be matched, listing available statuses
 */
export async function resolveStatusNames(
  client: LacrmClient,
  pipelineId: string,
  names: string[]
): Promise<string[]> {
  const result = await client.call<StatusInfo[]>('GetPipelineStatuses', { PipelineId: pipelineId });
  const statuses = Array.isArray(result) ? result : [];
  const resolved: string[] = [];
  const unmatched: string[] = [];

  for (const name of names) {
    const lower = name.toLowerCase();
    const match = statuses.find(s => s.Name.toLowerCase() === lower);
    if (match) {
      resolved.push(match.StatusId);
    } else {
      unmatched.push(name);
    }
  }

  if (unmatched.length > 0) {
    const available = statuses.map(s => s.Name).join(', ');
    throw new Error(`Status not found: ${unmatched.join(', ')}. Available statuses: ${available}`);
  }

  return resolved;
}

/**
 * Resolve user display names to their IDs.
 *
 * Matches against full name ("First Last"), first name only, or last name only.
 *
 * @param client - LACRM API client
 * @param names - Array of user names to resolve (case-insensitive)
 * @returns Array of resolved UserId values
 * @throws Error if any name cannot be matched, listing available users
 */
export async function resolveUserNames(
  client: LacrmClient,
  names: string[]
): Promise<string[]> {
  const result = await client.call<UserInfo[]>('GetUsers', {});
  const users = Array.isArray(result) ? result : [];
  const resolved: string[] = [];
  const unmatched: string[] = [];

  for (const name of names) {
    const lower = name.toLowerCase();
    const match = users.find(u => {
      const fullName = `${u.FirstName} ${u.LastName}`.toLowerCase();
      return fullName === lower || u.FirstName.toLowerCase() === lower || u.LastName.toLowerCase() === lower;
    });
    if (match) {
      resolved.push(match.UserId);
    } else {
      unmatched.push(name);
    }
  }

  if (unmatched.length > 0) {
    const available = users.map(u => `${u.FirstName} ${u.LastName}`).join(', ');
    throw new Error(`User not found: ${unmatched.join(', ')}. Available users: ${available}`);
  }

  return resolved;
}

/**
 * Resolve calendar display names to their IDs.
 *
 * @param client - LACRM API client
 * @param names - Array of calendar names to resolve (case-insensitive)
 * @returns Array of resolved CalendarId values
 * @throws Error if any name cannot be matched, listing available calendars
 */
export async function resolveCalendarNames(
  client: LacrmClient,
  names: string[]
): Promise<string[]> {
  const result = await client.call<CalendarInfo[]>('GetCalendars', {});
  const calendars = Array.isArray(result) ? result : [];
  const resolved: string[] = [];
  const unmatched: string[] = [];

  for (const name of names) {
    const lower = name.toLowerCase();
    const match = calendars.find(c => c.Name.toLowerCase() === lower);
    if (match) {
      resolved.push(match.CalendarId);
    } else {
      unmatched.push(name);
    }
  }

  if (unmatched.length > 0) {
    const available = calendars.map(c => c.Name).join(', ');
    throw new Error(`Calendar not found: ${unmatched.join(', ')}. Available calendars: ${available}`);
  }

  return resolved;
}

/**
 * Resolve custom field display names to their IDs and validate dropdown values.
 *
 * Returns a new object with field IDs as keys instead of field names.
 * For dropdown fields, validates that the supplied value is among the allowed options.
 *
 * @param client - LACRM API client
 * @param fieldNamesObj - Object mapping field names to their values
 * @param recordType - Record type for field lookup (e.g., 'Contact', 'Company', 'Pipeline')
 * @param pipelineId - Pipeline ID (required when recordType is 'Pipeline')
 * @returns Object with CustomFieldId keys mapped to the same values
 * @throws Error if any field name is not found or a dropdown value is invalid
 */
export async function resolveCustomFieldNames(
  client: LacrmClient,
  fieldNamesObj: Record<string, unknown>,
  recordType: string,
  pipelineId?: string
): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};

  if (pipelineId) {
    params.PipelineId = pipelineId;
  } else if (recordType) {
    params.RecordType = recordType;
  }

  const result = await client.call<CustomFieldInfo[]>('GetCustomFields', params);
  const fields = Array.isArray(result) ? result : [];

  const resolved: Record<string, unknown> = {};
  const unmatched: string[] = [];

  for (const [name, value] of Object.entries(fieldNamesObj)) {
    const lower = name.toLowerCase();
    const match = fields.find(f => f.Name.toLowerCase() === lower);
    if (match) {
      // Validate dropdown values if Options exist
      if (match.Options && match.Options.length > 0 && value !== null && value !== undefined) {
        const strValue = String(value);
        if (!match.Options.includes(strValue)) {
          throw new Error(`Invalid value "${strValue}" for field "${match.Name}". Valid options: ${match.Options.join(', ')}`);
        }
      }
      resolved[match.CustomFieldId] = value;
    } else {
      unmatched.push(name);
    }
  }

  if (unmatched.length > 0) {
    const available = fields.map(f => f.Name).join(', ');
    throw new Error(`Custom field not found: ${unmatched.join(', ')}. Available fields: ${available}`);
  }

  return resolved;
}
