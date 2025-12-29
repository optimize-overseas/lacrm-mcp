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

Returns the new ContactId on success.`,
      inputSchema: {
        name: z.string().describe('Full name of the contact or company name'),
        assigned_to: z.string().describe('User ID to assign the contact to. Use get_users to find valid IDs.'),
        is_company: z.boolean().describe('Set true to create a company, false for a person'),
        email: z.array(emailSchema).optional().describe('Email addresses'),
        phone: z.array(phoneSchema).optional().describe('Phone numbers'),
        company_name: z.string().optional().describe('Company name (for contacts). Creates company if not exists.'),
        job_title: z.string().optional().describe('Job title/position'),
        address: z.array(addressSchema).optional().describe('Physical addresses'),
        website: z.array(websiteSchema).optional().describe('Website URLs'),
        background_info: z.string().optional().describe('Additional notes/background'),
        birthday: z.string().optional().describe('Birthday in yyyy-mm-dd format. Use 0000-mm-dd for annual dates.'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom field values. Keys are field IDs from get_custom_fields.')
      }
    },
    async (args) => {
      try {
        const client = getClient();

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

        if (args.email) params.Email = args.email;
        if (args.phone) params.Phone = args.phone;
        if (!args.is_company && args.company_name) params['Company Name'] = args.company_name;
        if (args.job_title) params['Job Title'] = args.job_title;
        if (args.address) params.Address = args.address;
        if (args.website) params.Website = args.website;
        if (args.background_info) params['Background Info'] = args.background_info;
        if (args.birthday) params.Birthday = args.birthday;

        // Add custom fields directly to params
        if (args.custom_fields) {
          Object.assign(params, args.custom_fields);
        }

        const result = await client.call<{ ContactId: string }>('CreateContact', params);
        return {
          content: [{ type: 'text' as const, text: `Contact created successfully. ContactId: ${result.ContactId}` }]
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
Only include fields you want to change - other fields remain unchanged.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId of the record to edit'),
        name: z.string().optional().describe('Full name'),
        assigned_to: z.string().optional().describe('User ID to reassign to'),
        is_company: z.boolean().optional().describe('Change record type'),
        email: z.array(emailSchema).optional().describe('Email addresses (replaces all existing)'),
        phone: z.array(phoneSchema).optional().describe('Phone numbers (replaces all existing)'),
        company_name: z.string().optional().describe('Company name'),
        job_title: z.string().optional().describe('Job title'),
        address: z.array(addressSchema).optional().describe('Addresses (replaces all existing)'),
        website: z.array(websiteSchema).optional().describe('Website URLs'),
        background_info: z.string().optional().describe('Additional notes'),
        birthday: z.string().optional().describe('Birthday in yyyy-mm-dd format'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom field values to update')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          ContactId: args.contact_id
        };

        if (args.name !== undefined) params.Name = args.name;
        if (args.assigned_to !== undefined) params.AssignedTo = args.assigned_to;
        if (args.is_company !== undefined) params.IsCompany = args.is_company;
        if (args.email !== undefined) params.Email = args.email;
        if (args.phone !== undefined) params.Phone = args.phone;
        if (args.company_name !== undefined) params['Company Name'] = args.company_name;
        if (args.job_title !== undefined) params['Job Title'] = args.job_title;
        if (args.address !== undefined) params.Address = args.address;
        if (args.website !== undefined) params.Website = args.website;
        if (args.background_info !== undefined) params['Background Info'] = args.background_info;
        if (args.birthday !== undefined) params.Birthday = args.birthday;

        if (args.custom_fields) {
          Object.assign(params, args.custom_fields);
        }

        await client.call('EditContact', params);
        return {
          content: [{ type: 'text' as const, text: `Contact ${args.contact_id} updated successfully.` }]
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
      description: `Retrieve a single contact or company by ID with all fields.
Use this tool to get complete details for a specific contact including custom fields.

Returns full contact data: name, email, phone, address, company, custom fields, timestamps, etc.
Use search_contacts first if you don't have the contact ID.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId of the record to retrieve')
      }
    },
    async ({ contact_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetContact', { ContactId: contact_id });
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
Use this tool when you have a list of contact IDs and need details for all of them.
More efficient than calling get_contact multiple times.

Returns array of contact objects with pagination info.
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

        const result = await client.call('GetContactsById', params);
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

Supports:
- Free text search across all fields
- Filter by contacts only, companies only, or both
- Filter by assigned user
- Sort by name, date created, last update, or relevance
- Advanced filters for custom fields

Use get_custom_fields to learn available custom field names for advanced filtering.
Returns array of matching contacts with pagination info.`,
      inputSchema: {
        search_terms: z.string().optional().describe('Text to search across all fields'),
        record_type: z.enum(['Contacts', 'Companies']).optional().describe('Filter by record type'),
        owner_filter: z.array(z.string()).optional().describe('Filter by assigned user IDs'),
        sort_by: z.enum(['Relevance', 'FirstName', 'LastName', 'CompanyName', 'DateCreated', 'LastUpdate']).optional(),
        sort_direction: z.enum(['Ascending', 'Descending']).optional(),
        max_results: z.number().optional().describe('Max results per page (default 500, max 10000)'),
        page: z.number().optional().describe('Page number for pagination'),
        advanced_filters: z.array(z.object({
          Name: z.string().describe('Field name to filter on'),
          Operation: z.string().describe('Filter operation: Contains, IsExactly, IsBetween, etc.'),
          Value: z.unknown().describe('Value to filter by')
        })).optional().describe('Advanced field filters')
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
        if (args.max_results) params.MaxNumberOfResults = args.max_results;
        if (args.page) params.Page = args.page;
        if (args.advanced_filters) params.AdvancedFilters = args.advanced_filters;

        const result = await client.call('GetContacts', params);
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
}
