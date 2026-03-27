/**
 * Contact Tools for LACRM MCP Server
 *
 * Full CRUD operations for contacts and companies:
 * - create_contact: Add new person or company
 * - edit_contact: Update contact details
 * - delete_contact: Remove contact permanently
 * - get_contact: Retrieve single contact by ID
 * - get_contacts_by_ids: Batch retrieve multiple contacts
 * - search_contacts: Find contacts with filters
 *
 * Contacts are the core entity in LACRM. All other entities
 * (events, tasks, notes, etc.) attach to contacts.
 *
 * @module tools/contacts
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';
import { summarizeResults } from '../../utils/summarize.js';
import { resolveCustomFieldNames } from '../../utils/resolve-names.js';
import { countAll } from '../../utils/count-all.js';

// Shared schemas for contact data
const emailSchema = z.object({
  Text: z.string().describe('Email address'),
  Type: z.string().optional().describe('Category: Work, Personal, etc.')
});

const phoneSchema = z.object({
  Text: z.string().describe('Phone number'),
  Type: z.string().optional().describe('Category: Work, Mobile, Home, etc.')
});

const addressSchema = z.object({
  Street: z.string().optional(),
  City: z.string().optional(),
  State: z.string().optional(),
  Zip: z.string().optional(),
  Country: z.string().optional(),
  Type: z.string().optional().describe('Category: Work, Home, etc.')
});

const websiteSchema = z.object({
  Text: z.string().describe('Website URL'),
  Type: z.string().optional()
});

export function registerContactTools(server: McpServer): void {
  // create_contact
  server.registerTool(
    'create_contact',
    {
      title: 'Create Contact',
      description: `Create a new contact or company in Less Annoying CRM.

PREREQUISITES (call these first):
1. get_contact_schema (or get_company_schema for companies) → see ALL fields (required and optional), their types, and formats
2. get_users → get valid user IDs for the required assigned_to field

Use this tool when you need to add a new person or company to the CRM.
Set is_company to true to create a company record instead of a person.

Supports flat-string shortcuts: use email_address, phone_number, or website_url for single values instead of the array format.
Supports custom_field_names for name-based custom field resolution.

Returns the new ContactId on success.`,
      inputSchema: {
        name: z.string().describe('Full name of the contact or company name'),
        assigned_to: z.string().describe('User ID to assign the contact to. Use get_users to find valid IDs.'),
        is_company: z.boolean().describe('Set true to create a company, false for a person'),
        email: z.array(emailSchema).optional().describe('Email addresses array'),
        phone: z.array(phoneSchema).optional().describe('Phone numbers array'),
        email_address: z.string().optional().describe('Single email address (auto-converts to Work type). For multiple emails, use email array instead.'),
        phone_number: z.string().optional().describe('Single phone number (auto-converts to Work type). For multiple phones, use phone array instead.'),
        website_url: z.string().optional().describe('Single website URL. For multiple websites, use website array instead.'),
        company_name: z.string().optional().describe('Company name (for contacts). Creates company if not exists.'),
        job_title: z.string().optional().describe('Job title/position'),
        address: z.array(addressSchema).optional().describe('Physical addresses'),
        website: z.array(websiteSchema).optional().describe('Website URLs'),
        background_info: z.string().optional().describe('Additional notes/background'),
        birthday: z.string().optional().describe('Birthday in yyyy-mm-dd format. Use 0000-mm-dd for annual dates.'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom field values keyed by field ID. Mutually exclusive with custom_field_names.'),
        custom_field_names: z.record(z.unknown()).optional().describe('Custom field values keyed by field name (case-insensitive, auto-resolved to IDs). Mutually exclusive with custom_fields.')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        // Validation: mutually exclusive shortcuts
        if (args.email_address && args.email) {
          throw new Error('Use email_address or email array, not both');
        }
        if (args.phone_number && args.phone) {
          throw new Error('Use phone_number or phone array, not both');
        }
        if (args.website_url && args.website) {
          throw new Error('Use website_url or website array, not both');
        }
        if (args.custom_fields && args.custom_field_names) {
          throw new Error('Use custom_fields or custom_field_names, not both');
        }

        // Convert flat-string shortcuts to array format
        const emails = args.email_address ? [{ Text: args.email_address, Type: 'Work' }] : args.email;
        const phones = args.phone_number ? [{ Text: args.phone_number, Type: 'Work' }] : args.phone;
        const websites = args.website_url ? [{ Text: args.website_url }] : args.website;

        const params: Record<string, unknown> = {
          AssignedTo: args.assigned_to,
          IsCompany: args.is_company
        };

        // API uses different field names for person vs company
        if (args.is_company) {
          params['Company Name'] = args.name;
        } else {
          params.Name = args.name;
        }

        if (emails) params.Email = emails;
        if (phones) params.Phone = phones;
        if (!args.is_company && args.company_name) params['Company Name'] = args.company_name;
        if (args.job_title) params['Job Title'] = args.job_title;
        if (args.address) params.Address = args.address;
        if (websites) params.Website = websites;
        if (args.background_info) params['Background Info'] = args.background_info;
        if (args.birthday) params.Birthday = args.birthday;

        // Resolve custom field names to IDs
        if (args.custom_field_names) {
          const recordType = args.is_company ? 'Company' : 'Contact';
          const resolvedFields = await resolveCustomFieldNames(client, args.custom_field_names, recordType);
          Object.assign(params, resolvedFields);
        } else if (args.custom_fields) {
          Object.assign(params, args.custom_fields);
        }

        const result = await client.call<{ ContactId: string }>('CreateContact', params);
        const contactUrl = `https://account.lessannoyingcrm.com/app/View_Contact?ContactId=${result.ContactId}`;
        return {
          content: [{ type: 'text' as const, text: `Contact created successfully. ContactId: ${result.ContactId}\nContactUrl: ${contactUrl}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_contact
  server.registerTool(
    'edit_contact',
    {
      title: 'Edit Contact',
      description: `Update an existing contact or company in Less Annoying CRM.

PREREQUISITES (call these first):
1. get_contact_schema (or get_company_schema) → see available fields, their types, and formats
2. search_contacts or get_contact → find/verify valid contact_id

Use this tool to modify contact details like name, email, phone, etc.
Only include fields you want to change - other fields remain unchanged.

Supports flat-string shortcuts: use email_address, phone_number, or website_url for single values.
Supports custom_field_names for name-based custom field resolution.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId of the record to edit'),
        name: z.string().optional().describe('Full name'),
        assigned_to: z.string().optional().describe('User ID to reassign to'),
        is_company: z.boolean().optional().describe('Change record type'),
        email: z.array(emailSchema).optional().describe('Email addresses (replaces all existing)'),
        phone: z.array(phoneSchema).optional().describe('Phone numbers (replaces all existing)'),
        email_address: z.string().optional().describe('Single email address (auto-converts to Work type). For multiple emails, use email array instead.'),
        phone_number: z.string().optional().describe('Single phone number (auto-converts to Work type). For multiple phones, use phone array instead.'),
        website_url: z.string().optional().describe('Single website URL. For multiple websites, use website array instead.'),
        company_name: z.string().optional().describe('Company name'),
        job_title: z.string().optional().describe('Job title'),
        address: z.array(addressSchema).optional().describe('Addresses (replaces all existing)'),
        website: z.array(websiteSchema).optional().describe('Website URLs'),
        background_info: z.string().optional().describe('Additional notes'),
        birthday: z.string().optional().describe('Birthday in yyyy-mm-dd format'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom field values to update keyed by field ID. Mutually exclusive with custom_field_names.'),
        custom_field_names: z.record(z.unknown()).optional().describe('Custom field values keyed by field name (case-insensitive, auto-resolved to IDs). Mutually exclusive with custom_fields.')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        // Validation: mutually exclusive shortcuts
        if (args.email_address && args.email) {
          throw new Error('Use email_address or email array, not both');
        }
        if (args.phone_number && args.phone) {
          throw new Error('Use phone_number or phone array, not both');
        }
        if (args.website_url && args.website) {
          throw new Error('Use website_url or website array, not both');
        }
        if (args.custom_fields && args.custom_field_names) {
          throw new Error('Use custom_fields or custom_field_names, not both');
        }

        // Convert flat-string shortcuts to array format
        const emails = args.email_address ? [{ Text: args.email_address, Type: 'Work' }] : args.email;
        const phones = args.phone_number ? [{ Text: args.phone_number, Type: 'Work' }] : args.phone;
        const websites = args.website_url ? [{ Text: args.website_url }] : args.website;

        const params: Record<string, unknown> = {
          ContactId: args.contact_id
        };

        if (args.name !== undefined) params.Name = args.name;
        if (args.assigned_to !== undefined) params.AssignedTo = args.assigned_to;
        if (args.is_company !== undefined) params.IsCompany = args.is_company;
        if (emails !== undefined) params.Email = emails;
        if (phones !== undefined) params.Phone = phones;
        if (args.company_name !== undefined) params['Company Name'] = args.company_name;
        if (args.job_title !== undefined) params['Job Title'] = args.job_title;
        if (args.address !== undefined) params.Address = args.address;
        if (websites !== undefined) params.Website = websites;
        if (args.background_info !== undefined) params['Background Info'] = args.background_info;
        if (args.birthday !== undefined) params.Birthday = args.birthday;

        // Resolve custom field names to IDs
        if (args.custom_field_names) {
          const recordType = args.is_company ? 'Company' : 'Contact';
          const resolvedFields = await resolveCustomFieldNames(client, args.custom_field_names, recordType);
          Object.assign(params, resolvedFields);
        } else if (args.custom_fields) {
          Object.assign(params, args.custom_fields);
        }

        // Detect empty update — no fields besides ContactId were provided.
        // This typically happens when the caller uses the wrong parameter name
        // (e.g., "company" instead of "company_name"), which Zod silently strips.
        const updateFields = Object.keys(params).filter(k => k !== 'ContactId');
        if (updateFields.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `Error: No valid fields to update were provided. Available fields: name, assigned_to, is_company, email, phone, email_address, phone_number, website_url, company_name, job_title, address, website, background_info, birthday, custom_fields, custom_field_names. Note: use "company_name" (not "company") for the company field.` }],
            isError: true
          };
        }

        await client.call('EditContact', params);
        return {
          content: [{ type: 'text' as const, text: `Contact ${args.contact_id} updated successfully. Fields changed: ${updateFields.join(', ')}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_contact
  server.registerTool(
    'delete_contact',
    {
      title: 'Delete Contact',
      description: `Permanently delete a contact or company from Less Annoying CRM.
WARNING: This action cannot be undone. The contact and all associated data will be removed.

Required: contact_id.
Use search_contacts or get_contact to find valid contact IDs before deleting.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId of the record to delete')
      }
    },
    async ({ contact_id }) => {
      try {
        const client = getClient();
        await client.call('DeleteContact', { ContactId: contact_id });
        return {
          content: [{ type: 'text' as const, text: `Contact ${contact_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_contact
  server.registerTool(
    'get_contact',
    {
      title: 'Get Contact',
      description: `Retrieve a single contact or company by ID.
Use this when you already have a ContactId and need the record.

NOTE: search_contacts returns the same full data for each match. Only use get_contact when you have an ID but not the data (e.g., from a webhook or external reference).`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId of the record to retrieve')
      }
    },
    async ({ contact_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetContact', { ContactId: contact_id }) as { ContactId?: string;[key: string]: unknown };

        // Put ContactUrl first so it's visible even if response is truncated
        if (result.ContactId) {
          const { ContactId, ...rest } = result;
          const reordered = {
            ContactId,
            ContactUrl: `https://account.lessannoyingcrm.com/app/View_Contact?ContactId=${ContactId}`,
            ...rest
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(reordered, null, 2) }]
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_contacts_by_ids
  server.registerTool(
    'get_contacts_by_ids',
    {
      title: 'Get Contacts By IDs',
      description: `Retrieve multiple contacts or companies by their IDs.
Use this when you have a list of ContactIds (e.g., from webhooks or external references).

RETURNS FULL DATA: Each result includes all contact fields - same as search_contacts or get_contact.
Maximum 10,000 results per call.`,
      inputSchema: {
        contact_ids: z.array(z.string()).describe('Array of ContactIds to retrieve'),
        max_results: z.number().optional().describe('Max results per page (default 500, max 10000)'),
        page: z.number().optional().describe('Page number for pagination (default 1)')
      }
    },
    async ({ contact_ids, max_results, page }) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          ContactIds: contact_ids
        };
        if (max_results) params.MaxNumberOfResults = max_results;
        if (page) params.Page = page;

        const result = await client.call('GetContactsById', params) as { Result?: Array<{ ContactId: string;[key: string]: unknown }> };

        // Put ContactUrl first in each contact so it's visible even if response is truncated
        if (result.Result && Array.isArray(result.Result)) {
          result.Result = result.Result.map(contact => {
            if (contact.ContactId) {
              const { ContactId, ...rest } = contact;
              return {
                ContactId,
                ContactUrl: `https://account.lessannoyingcrm.com/app/View_Contact?ContactId=${ContactId}`,
                ...rest
              };
            }
            return contact;
          });
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // search_contacts
  server.registerTool(
    'search_contacts',
    {
      title: 'Search Contacts',
      description: `Search for contacts and companies with filters and sorting.
Use this tool to find contacts by name, email, or other criteria.

RETURNS FULL DATA: Each result includes all contact fields (name, email, phone, address, company, custom fields, timestamps, etc.) - no need to call get_contact afterward.

Supports:
- Free text search across all fields
- Filter by contacts only, companies only, or both
- Filter by assigned user
- Sort by name, date created, last update, or relevance
- Advanced filters on standard and custom fields

IMPORTANT: For geographic searches (by state, city, zip), use advanced_filters with the address fields (AddressState, AddressCity, AddressZip, etc.) instead of search_terms. Free-text search_terms scans all fields and can be very slow on broad terms.

Use count_only=true for accurate counts on large datasets without returning the full result set.
Use get_custom_fields to learn available custom field names for advanced filtering.`,
      inputSchema: {
        search_terms: z.string().optional().describe('Text to search across all fields'),
        record_type: z.enum(['Contacts', 'Companies']).optional().describe('Filter by record type'),
        owner_filter: z.array(z.string()).optional().describe('Filter by assigned user IDs'),
        sort_by: z.enum(['Relevance', 'FirstName', 'LastName', 'CompanyName', 'DateCreated', 'LastUpdate']).optional(),
        sort_direction: z.enum(['Ascending', 'Descending']).optional(),
        max_results: z.number().optional().describe('Max results per page (default 25, max 10000). Keep low for name searches.'),
        page: z.number().optional().describe('Page number for pagination'),
        count_only: z.boolean().optional().describe('When true, auto-paginates and returns only total count and breakdowns (no results array). Use for accurate counts on large datasets.'),
        advanced_filters: z.array(z.object({
          Name: z.string().describe('Field name to filter on. Standard fields available on all accounts: Group, FullName, FirstName, MiddleName, LastName, CompanyName, CompanyId, Salutation, Suffix, DateEntered, DateUpdated, Email, AddressStreet, AddressCity, AddressState, AddressZip, AddressCountry, Phone, Website, Title, BackgroundInfo, Industry, Birthday, Age, NumEmp, Cal, Pipeline. Custom fields use Custom_<id> format — call get_custom_fields to discover them.'),
          Operation: z.enum([
            // Text field operations
            'Contains',
            'DoesNotContain',
            'IsExactly',
            'IsNot',
            'IsEmpty',
            'IsNotEmpty',
            // Date field operations
            'IsExactly',
            'IsBetween',
            'IsBefore',
            'IsAfter',
            // Numeric field operations
            'IsExactly',
            'IsGreaterThan',
            'IsLessThan',
            'Contains',
            'IsEmpty',
            'IsNotEmpty',
            // Group field operations
            'IsNotInAnyGroup',
            'IsInGroupList',
            'IsNotInGroupList'
          ]).describe(`Filter operation. Valid operations depend on field type:
- Text fields (FullName, Email, Phone, AddressState, AddressCity, etc.): Contains, DoesNotContain, IsExactly, IsNot, IsEmpty, IsNotEmpty
- Date fields (DateEntered, DateUpdated, Birthday): IsExactly, IsBetween, IsBefore, IsAfter
- Numeric fields (Age, NumEmp): IsExactly, IsGreaterThan, IsLessThan, Contains, IsEmpty, IsNotEmpty
- Group field: IsNotInAnyGroup, IsInGroupList, IsNotInGroupList`),
          Value: z.unknown().describe('Value to filter by. Type depends on operation: Text for text ops, Date (YYYY-MM-DD) for date ops, {StartDate, EndDate} for IsBetween, Array of UIDs for group list ops, null for IsEmpty/IsNotEmpty')
        })).optional().describe('Advanced field filters. Call get_contact_schema (for contacts) or get_company_schema (for companies) first to see available field names.')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {};

        if (args.search_terms) params.SearchTerms = args.search_terms;
        if (args.record_type) params.RecordTypeFilter = args.record_type;
        if (args.owner_filter) params.OwnerFilter = args.owner_filter;
        if (args.sort_by) params.SortBy = args.sort_by;
        if (args.sort_direction) params.SortDirection = args.sort_direction;
        // Default to 25 results to keep responses within token limits for LLM consumption
        params.MaxNumberOfResults = args.max_results ?? 25;
        if (args.page) params.Page = args.page;
        if (args.advanced_filters) params.AdvancedFilters = args.advanced_filters;

        // count_only mode: auto-paginate and return just summary
        if (args.count_only) {
          const countResult = await countAll(client, 'GetContacts', params, [
            { label: 'by_assigned_to', path: 'AssignedTo' }
          ]);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(countResult, null, 2) }]
          };
        }

        const result = await client.call('GetContacts', params) as { Result?: Array<{ ContactId: string;[key: string]: unknown }> };

        // Put ContactUrl first in each contact so it's visible even if response is truncated
        const contactsArray = (result.Result || []).map(contact => {
          if (contact.ContactId) {
            const { ContactId, ...rest } = contact;
            return {
              ContactId,
              ContactUrl: `https://account.lessannoyingcrm.com/app/View_Contact?ContactId=${ContactId}`,
              ...rest
            };
          }
          return contact;
        });

        return {
          content: [{
            type: 'text' as const,
            text: summarizeResults(contactsArray, false, [
              { label: 'by_assigned_to', path: 'AssignedTo' }
            ])
          }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );
}
