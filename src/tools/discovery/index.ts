/**
 * Discovery Tools for LACRM MCP Server
 *
 * Tools that help the LLM discover the account structure before performing operations:
 * - get_workflow_guide: START HERE - explains what tools to call before any operation
 * - get_custom_fields: Learn custom field IDs, types, requirements for contacts/pipelines
 * - get_pipeline_custom_fields: Get custom fields for a specific pipeline (convenience tool)
 * - get_pipelines: Discover pipelines and their statuses
 * - get_groups: Find available contact groups
 * - get_users: List users for assignment and filtering
 * - get_calendars: Discover calendars for event creation
 *
 * Recommended workflow: Call get_workflow_guide first to understand the MCP,
 * then call the appropriate schema tools before creating or modifying records.
 *
 * @module tools/discovery
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

/**
 * Schema field definition for AI consumption
 */
interface SchemaField {
  name: string;
  required: boolean;
  type: string;
  input_format: string;
  valid_options?: string[];
  is_custom_field: boolean;
  field_id?: string;
  notes?: string;
}

/**
 * Fixed fields for Contact records
 */
const CONTACT_FIXED_FIELDS: SchemaField[] = [
  {
    name: 'name',
    required: true,
    type: 'Text',
    input_format: 'Full name as string (e.g., "John Smith")',
    is_custom_field: false,
    notes: 'For contacts, use full name. For companies, this becomes the company name.'
  },
  {
    name: 'assigned_to',
    required: true,
    type: 'Uid',
    input_format: 'User ID from get_users (e.g., "123456789")',
    is_custom_field: false,
    notes: 'Use get_users to find valid user IDs'
  },
  {
    name: 'email',
    required: false,
    type: 'Array',
    input_format: 'Array of {text: "email@example.com", type: "Work"|"Personal"|"Other"}',
    is_custom_field: false,
    notes: 'Can include multiple email addresses with different types'
  },
  {
    name: 'phone',
    required: false,
    type: 'Array',
    input_format: 'Array of {text: "555-123-4567", type: "Work"|"Mobile"|"Home"|"Fax"|"Other"}',
    is_custom_field: false,
    notes: 'Can include multiple phone numbers with different types'
  },
  {
    name: 'company_name',
    required: false,
    type: 'Text',
    input_format: 'Company name as string',
    is_custom_field: false,
    notes: 'Links contact to existing company or creates new one if not found'
  },
  {
    name: 'job_title',
    required: false,
    type: 'Text',
    input_format: 'Job title as string (e.g., "Sales Manager")',
    is_custom_field: false
  },
  {
    name: 'address',
    required: false,
    type: 'Array',
    input_format: 'Array of {street, city, state, zip, country, type: "Work"|"Home"|"Other"}',
    is_custom_field: false,
    notes: 'Can include multiple addresses with different types'
  },
  {
    name: 'website',
    required: false,
    type: 'Array',
    input_format: 'Array of {text: "https://example.com", type: "Work"|"Personal"|"Other"}',
    is_custom_field: false
  },
  {
    name: 'background_info',
    required: false,
    type: 'Text',
    input_format: 'Free-form text for notes about the contact',
    is_custom_field: false
  },
  {
    name: 'birthday',
    required: false,
    type: 'Date',
    input_format: 'YYYY-MM-DD for full date, or 0000-MM-DD for annual (no year)',
    is_custom_field: false,
    notes: 'Use 0000 as year for recurring annual dates'
  }
];

/**
 * Fixed fields for Company records
 */
const COMPANY_FIXED_FIELDS: SchemaField[] = [
  {
    name: 'name',
    required: true,
    type: 'Text',
    input_format: 'Company name as string (must be unique)',
    is_custom_field: false,
    notes: 'Company names must be unique in the account'
  },
  {
    name: 'assigned_to',
    required: true,
    type: 'Uid',
    input_format: 'User ID from get_users (e.g., "123456789")',
    is_custom_field: false,
    notes: 'Use get_users to find valid user IDs'
  },
  {
    name: 'email',
    required: false,
    type: 'Array',
    input_format: 'Array of {text: "email@example.com", type: "Work"|"Other"}',
    is_custom_field: false
  },
  {
    name: 'phone',
    required: false,
    type: 'Array',
    input_format: 'Array of {text: "555-123-4567", type: "Work"|"Fax"|"Other"}',
    is_custom_field: false
  },
  {
    name: 'address',
    required: false,
    type: 'Array',
    input_format: 'Array of {street, city, state, zip, country, type: "Work"|"Other"}',
    is_custom_field: false
  },
  {
    name: 'website',
    required: false,
    type: 'Array',
    input_format: 'Array of {text: "https://example.com", type: "Work"|"Other"}',
    is_custom_field: false
  },
  {
    name: 'background_info',
    required: false,
    type: 'Text',
    input_format: 'Free-form text for notes about the company',
    is_custom_field: false
  }
];

/**
 * Fixed fields for Pipeline Item records
 */
const PIPELINE_ITEM_FIXED_FIELDS: SchemaField[] = [
  {
    name: 'contact_id',
    required: true,
    type: 'Uid',
    input_format: 'Contact or Company ID to attach the pipeline item to',
    is_custom_field: false,
    notes: 'Use search_contacts to find valid contact IDs'
  },
  {
    name: 'pipeline_id',
    required: true,
    type: 'Uid',
    input_format: 'Pipeline ID from get_pipelines',
    is_custom_field: false,
    notes: 'Use get_pipelines to find valid pipeline IDs'
  },
  {
    name: 'status_id',
    required: true,
    type: 'Uid',
    input_format: 'Status ID from get_pipelines (nested in pipeline.Statuses)',
    is_custom_field: false,
    notes: 'Each pipeline has its own set of valid status IDs'
  },
  {
    name: 'note',
    required: false,
    type: 'Text',
    input_format: 'Free-form text note for the pipeline item history',
    is_custom_field: false
  }
];

/**
 * Extended custom field interface with all API-returned properties
 */
interface CustomFieldDetail {
  CustomFieldId: string;
  Name: string;
  Type: string;
  RecordType?: string;
  PipelineId?: string;
  IsRequired?: boolean;
  IsArchived?: boolean;
  Options?: Array<string | { Value?: string; Name?: string; OptionId?: string }>;
  Description?: string;
}

/**
 * AI-friendly formatted custom field
 */
interface FormattedCustomField {
  name: string;
  field_id: string;
  type: string;
  required: boolean;
  input_format: string;
  valid_options?: string[];
  record_type?: string;
  pipeline_id?: string;
}

/**
 * Pipeline definition returned by GetPipelines
 */
interface Pipeline {
  PipelineId: string;
  Name: string;
  Icon?: string;
  Statuses?: Array<{
    StatusId: string;
    Name: string;
    SortOrder: number;
  }>;
}

/**
 * Group definition returned by GetGroups
 */
interface Group {
  GroupId: string;
  Name: string;
  Description?: string;
}

/**
 * User definition returned by GetUsers
 */
interface User {
  UserId: string;
  Name: string;
  Email: string;
  Role?: string;
}

/**
 * Calendar definition returned by GetCalendars
 */
interface Calendar {
  CalendarId: string;
  Name: string;
  UserId: string;
}

/**
 * Get the expected input format description for a field type
 */
function getInputFormatDescription(type: string): string {
  const formats: Record<string, string> = {
    'Text': 'String value (single line)',
    'TextArea': 'String value (can be multi-line)',
    'Number': 'Numeric value (integer or decimal)',
    'Currency': 'Numeric value (will be formatted as currency)',
    'Date': 'Date string in YYYY-MM-DD format',
    'Dropdown': 'Exactly one of the valid options (case-sensitive)',
    'RadioList': 'Exactly one of the valid options (case-sensitive)',
    'Checkbox': 'Array of selected options, e.g. ["Option1", "Option2"]',
    'ContactLink': 'ContactId of the linked contact',
    'FileLink': 'FileId of the linked file',
    'Signature': 'Signature data (typically from form submission)',
    'Section': 'Container field - not directly editable',
    'SectionHeader': 'Display field - not directly editable',
    'TextBlock': 'Display field - not directly editable'
  };
  return formats[type] || 'String value';
}

/**
 * Format a custom field for AI-friendly output
 */
function formatCustomFieldForAI(field: CustomFieldDetail): FormattedCustomField {
  const formatted: FormattedCustomField = {
    name: field.Name,
    field_id: field.CustomFieldId,
    type: field.Type,
    required: field.IsRequired || false,
    input_format: getInputFormatDescription(field.Type)
  };

  if (field.Options && field.Options.length > 0) {
    formatted.valid_options = field.Options.map(opt =>
      typeof opt === 'string' ? opt : (opt.Value || opt.Name || String(opt))
    );
  }

  if (field.RecordType) {
    formatted.record_type = field.RecordType;
  }

  if (field.PipelineId) {
    formatted.pipeline_id = field.PipelineId;
  }

  return formatted;
}

/**
 * Workflow guide content - helps AI understand how to use this MCP effectively
 */
const WORKFLOW_GUIDE = `# LACRM MCP Workflow Guide

## START HERE - Before ANY Create/Edit Operation

ALWAYS call the appropriate schema tool FIRST to understand required fields and their formats.

| Operation | Call First | Why |
|-----------|------------|-----|
| Create/edit CONTACT | get_contact_schema | See all fields (fixed + custom), required status, formats |
| Create/edit COMPANY | get_company_schema | See all fields (fixed + custom), required status, formats |
| Create/edit PIPELINE ITEM | get_pipeline_item_schema(pipeline_id) | See required custom fields and valid dropdown options |
| Assign to user | get_users | Get valid user IDs |
| Add to group | get_groups | Get valid group IDs |
| Create event | get_calendars | Get valid calendar IDs |

## What Schema Tools Return

Each schema tool returns field information including:

- **name**: The parameter name to use in create/edit calls
- **required**: true/false - MUST be provided if true
- **type**: Field type (Text, Dropdown, Date, Array, etc.)
- **input_format**: Exact format expected (e.g., "YYYY-MM-DD" for dates)
- **valid_options**: For Dropdown/RadioList fields, the exact allowed values
- **is_custom_field**: true for account-specific fields, false for built-in fields

## Quick Reference: Required Fields

### Contact (minimum required):
- name: Full name as string
- assigned_to: User ID from get_users
- is_company: false

### Company (minimum required):
- name: Company name (must be unique)
- assigned_to: User ID from get_users
- is_company: true

### Pipeline Item (minimum required):
- contact_id: Contact to attach to
- pipeline_id: Pipeline ID from get_pipelines
- status_id: Status ID from get_pipelines
- custom_fields: Check get_pipeline_item_schema for required fields

## Example Workflows

### Creating a Contact:
1. Call get_contact_schema → see required fields (name, assigned_to)
2. Call get_users → find valid user ID for assigned_to
3. Call create_contact with { name, assigned_to, is_company: false, ... }

### Creating a Pipeline Item:
1. Call get_pipelines → find pipeline_id and status_id
2. Call get_pipeline_item_schema(pipeline_id) → see required custom fields
3. Call search_contacts → find contact_id
4. Call create_pipeline_item with { contact_id, pipeline_id, status_id, custom_fields: {...} }

## Error Recovery

If you receive an error about a missing required field, call the appropriate schema tool to see what fields are needed.

Example error: "'Hunter' field is required for CreatePipelineItem"
Solution: Call get_pipeline_item_schema(pipeline_id) to see the Hunter field's valid options.
`;

export function registerDiscoveryTools(server: McpServer): void {
  // get_workflow_guide - START HERE tool
  server.registerTool(
    'get_workflow_guide',
    {
      title: 'Get Workflow Guide',
      description: `START HERE: Get the workflow guide for using this LACRM MCP effectively.

This tool explains:
- What schema tools to call BEFORE any create/edit operation
- Required fields for contacts, companies, and pipeline items
- Example workflows for common operations
- How to interpret schema responses

Call this tool first when connecting to understand how to use the MCP correctly.`,
      inputSchema: {}
    },
    async () => {
      return {
        content: [{ type: 'text' as const, text: WORKFLOW_GUIDE }]
      };
    }
  );

  // get_custom_fields
  server.registerTool(
    'get_custom_fields',
    {
      title: 'Get Custom Fields',
      description: `Retrieve custom field definitions for this LACRM account.
Use this tool FIRST when you need to work with contacts or pipeline items that have custom fields.

IMPORTANT: Returns field details including:
- name: The field name to use as key when setting values
- required: Whether this field must be provided
- type: The field type (Text, Number, Dropdown, etc.)
- input_format: Description of expected value format
- valid_options: For Dropdown/RadioList/Checkbox, the allowed values

Filter options:
- record_type: "Contact", "Company", or "Pipeline" to filter by type
- pipeline_id: Get fields for a specific pipeline (required when record_type is "Pipeline")

Example: To create a pipeline item, first call get_custom_fields with record_type="Pipeline" and the pipeline_id.
Then use the field names as keys in custom_fields: { "FieldName": "value" }`,
      inputSchema: {
        record_type: z.enum(['Contact', 'Company', 'Pipeline']).optional()
          .describe('Filter by record type: Contact, Company, or Pipeline'),
        pipeline_id: z.string().optional()
          .describe('Pipeline ID - required when record_type is "Pipeline"'),
        include_archived: z.boolean().optional()
          .describe('Include archived/deleted fields (default: false)')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {};
        if (args.record_type) params.RecordType = args.record_type;
        if (args.pipeline_id) params.PipelineId = args.pipeline_id;
        if (args.include_archived) params.IncludeArchivedFields = args.include_archived;

        const result = await client.call<{ Results?: CustomFieldDetail[]; HasMoreResults?: boolean } | CustomFieldDetail[]>('GetCustomFields', params);

        // Handle both array and paginated response formats
        const fields = Array.isArray(result) ? result : (result.Results || []);

        // Format fields for AI consumption
        const formattedFields = fields.map(formatCustomFieldForAI);

        // Group by record type for clarity
        const grouped: Record<string, FormattedCustomField[]> = {};
        for (const field of formattedFields) {
          const key = field.record_type || 'Unknown';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(field);
        }

        const output = {
          summary: {
            total_fields: formattedFields.length,
            required_fields: formattedFields.filter(f => f.required).map(f => f.name),
            by_record_type: Object.fromEntries(
              Object.entries(grouped).map(([type, flds]) => [type, flds.length])
            )
          },
          usage_notes: {
            contact_fields: "Use field 'name' as key when creating/editing contacts",
            pipeline_fields: "Use field 'name' as key in custom_fields parameter when creating/editing pipeline items",
            dropdown_fields: "Value must exactly match one of the valid_options (case-sensitive)"
          },
          fields: args.record_type ? formattedFields : grouped
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_pipeline_custom_fields - convenience tool for pipeline fields
  server.registerTool(
    'get_pipeline_custom_fields',
    {
      title: 'Get Pipeline Custom Fields',
      description: `Get custom fields for a specific pipeline - use this before creating or editing pipeline items.

Returns all custom fields configured for the pipeline with:
- name: The field name to use as key in custom_fields parameter
- required: Whether this field MUST be provided when creating pipeline items
- type: Field type (Text, Number, Dropdown, etc.)
- input_format: Description of the expected value format
- valid_options: For Dropdown/RadioList fields, the exact values you can use

WORKFLOW:
1. Call get_pipelines to find the PipelineId
2. Call get_pipeline_custom_fields with the pipeline_id
3. Note all required fields and their valid options
4. Call create_pipeline_item with custom_fields: { "FieldName": "value", ... }

Example response interpretation:
{
  "name": "Deal Stage",
  "required": true,
  "type": "Dropdown",
  "valid_options": ["Prospect", "Qualified", "Proposal"]
}
→ You MUST include this field, value must be exactly "Prospect", "Qualified", or "Proposal"`,
      inputSchema: {
        pipeline_id: z.string().describe('The PipelineId to get custom fields for')
      }
    },
    async ({ pipeline_id }) => {
      try {
        const client = getClient();

        const result = await client.call<{ Results?: CustomFieldDetail[]; HasMoreResults?: boolean } | CustomFieldDetail[]>(
          'GetCustomFields',
          { RecordType: 'Pipeline', PipelineId: pipeline_id }
        );

        // Handle both array and paginated response formats
        const fields = Array.isArray(result) ? result : (result.Results || []);

        // Format fields for AI consumption
        const formattedFields = fields.map(formatCustomFieldForAI);

        const requiredFields = formattedFields.filter(f => f.required);
        const optionalFields = formattedFields.filter(f => !f.required);

        const output = {
          pipeline_id,
          summary: {
            total_fields: formattedFields.length,
            required_count: requiredFields.length,
            optional_count: optionalFields.length
          },
          required_fields: requiredFields.length > 0 ? requiredFields : 'None - all fields are optional',
          optional_fields: optionalFields.length > 0 ? optionalFields : 'None',
          usage_example: requiredFields.length > 0
            ? `create_pipeline_item with custom_fields: { ${requiredFields.map(f =>
                `"${f.name}": ${f.valid_options ? `"${f.valid_options[0]}"` : '"value"'}`
              ).join(', ')} }`
            : 'No required custom fields - custom_fields parameter is optional'
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_pipelines
  server.registerTool(
    'get_pipelines',
    {
      title: 'Get Pipelines',
      description: `Retrieve all pipeline definitions for this LACRM account.
Use this tool to discover available pipelines and their statuses before creating or editing pipeline items.
Returns pipeline IDs, names, icons, and status definitions with sort order.

Each pipeline has multiple statuses that represent stages (e.g., "Lead", "Qualified", "Closed").
Use the PipelineId and StatusId values when creating or editing pipeline items.

WORKFLOW for pipeline items:
1. Call get_pipelines to find the PipelineId
2. Call get_pipeline_custom_fields with that pipeline_id to see required fields
3. Create/edit pipeline items with the correct PipelineId, StatusId, and custom_fields`,
      inputSchema: {}
    },
    async () => {
      try {
        const client = getClient();
        const result = await client.call<Pipeline[] | { Pipelines: Pipeline[] }>('GetPipelines');

        // Handle both array and object response formats
        const pipelines = Array.isArray(result) ? result : (result.Pipelines || []);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(pipelines, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_groups
  server.registerTool(
    'get_groups',
    {
      title: 'Get Groups',
      description: `Retrieve all contact groups defined in this LACRM account.
Use this tool to discover available groups before adding contacts to groups.
Returns group IDs, names, and descriptions.

Groups are used to organize contacts (e.g., "VIP Customers", "Newsletter Subscribers").
Use the GroupId when managing group memberships.`,
      inputSchema: {}
    },
    async () => {
      try {
        const client = getClient();
        const result = await client.call<Group[] | { Groups: Group[] } | { Results: Group[]; HasMoreResults: boolean }>('GetGroups');

        // Handle various response formats
        let groups: Group[];
        if (Array.isArray(result)) {
          groups = result;
        } else if ('Groups' in result) {
          groups = result.Groups;
        } else if ('Results' in result) {
          groups = result.Results;
        } else {
          groups = [];
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(groups, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_users
  server.registerTool(
    'get_users',
    {
      title: 'Get Users',
      description: `Retrieve all users in this LACRM account.
Use this tool to discover user IDs when you need to assign contacts, tasks, or events to specific users.
Returns user IDs, names, emails, and roles.

User IDs are required when creating events on a specific user's calendar or assigning tasks.`,
      inputSchema: {}
    },
    async () => {
      try {
        const client = getClient();
        const result = await client.call<User[] | { Users: User[] }>('GetUsers');

        // Handle both array and object response formats
        const users = Array.isArray(result) ? result : (result.Users || []);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(users, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_calendars
  server.registerTool(
    'get_calendars',
    {
      title: 'Get Calendars',
      description: `Retrieve all calendars in this LACRM account.
Use this tool to discover calendar IDs when creating events.
Returns calendar IDs, names, and associated user IDs.

Each user typically has their own calendar. Use CalendarId when creating calendar events.`,
      inputSchema: {}
    },
    async () => {
      try {
        const client = getClient();
        const result = await client.call<Calendar[] | { Calendars: Calendar[] }>('GetCalendars');

        // Handle both array and object response formats
        const calendars = Array.isArray(result) ? result : (result.Calendars || []);

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(calendars, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_contact_schema - Complete field schema for contacts
  server.registerTool(
    'get_contact_schema',
    {
      title: 'Get Contact Schema',
      description: `Get complete field schema for creating/editing contacts.

Returns ALL fields (both fixed system fields and custom fields) with:
- name: The parameter name to use in create_contact/edit_contact
- required: Whether this field must be provided
- type: Field type (Text, Array, Date, etc.)
- input_format: Exact format expected for the value
- is_custom_field: Whether this is a custom field (true) or built-in (false)
- notes: Additional guidance for using this field

ALWAYS call this before creating a contact to understand what data is needed.`,
      inputSchema: {}
    },
    async () => {
      try {
        const client = getClient();

        // Get custom fields for contacts
        const result = await client.call<{ Results?: CustomFieldDetail[]; HasMoreResults?: boolean } | CustomFieldDetail[]>(
          'GetCustomFields',
          { RecordType: 'Contact' }
        );

        const customFields = Array.isArray(result) ? result : (result.Results || []);

        // Convert custom fields to schema format
        const customFieldSchemas: SchemaField[] = customFields.map(field => ({
          name: field.Name,
          required: field.IsRequired || false,
          type: field.Type,
          input_format: getInputFormatDescription(field.Type),
          is_custom_field: true,
          field_id: field.CustomFieldId,
          valid_options: field.Options?.map(opt =>
            typeof opt === 'string' ? opt : (opt.Value || opt.Name || String(opt))
          )
        }));

        // Combine fixed and custom fields
        const allFields = [...CONTACT_FIXED_FIELDS, ...customFieldSchemas];
        const requiredFields = allFields.filter(f => f.required);

        const output = {
          record_type: 'Contact',
          summary: {
            total_fields: allFields.length,
            required_count: requiredFields.length,
            fixed_fields: CONTACT_FIXED_FIELDS.length,
            custom_fields: customFieldSchemas.length
          },
          required_fields: requiredFields,
          optional_fields: allFields.filter(f => !f.required),
          usage_example: `create_contact with: { name: "John Smith", assigned_to: "<user_id>", email: [{text: "john@example.com", type: "Work"}] }`
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_company_schema - Complete field schema for companies
  server.registerTool(
    'get_company_schema',
    {
      title: 'Get Company Schema',
      description: `Get complete field schema for creating/editing companies.

Returns ALL fields (both fixed system fields and custom fields) with:
- name: The parameter name to use in create_contact (with is_company=true)
- required: Whether this field must be provided
- type: Field type (Text, Array, etc.)
- input_format: Exact format expected for the value
- is_custom_field: Whether this is a custom field (true) or built-in (false)
- notes: Additional guidance for using this field

ALWAYS call this before creating a company to understand what data is needed.
Note: Companies are created using create_contact with is_company=true.`,
      inputSchema: {}
    },
    async () => {
      try {
        const client = getClient();

        // Get custom fields for companies
        const result = await client.call<{ Results?: CustomFieldDetail[]; HasMoreResults?: boolean } | CustomFieldDetail[]>(
          'GetCustomFields',
          { RecordType: 'Company' }
        );

        const customFields = Array.isArray(result) ? result : (result.Results || []);

        // Convert custom fields to schema format
        const customFieldSchemas: SchemaField[] = customFields.map(field => ({
          name: field.Name,
          required: field.IsRequired || false,
          type: field.Type,
          input_format: getInputFormatDescription(field.Type),
          is_custom_field: true,
          field_id: field.CustomFieldId,
          valid_options: field.Options?.map(opt =>
            typeof opt === 'string' ? opt : (opt.Value || opt.Name || String(opt))
          )
        }));

        // Combine fixed and custom fields
        const allFields = [...COMPANY_FIXED_FIELDS, ...customFieldSchemas];
        const requiredFields = allFields.filter(f => f.required);

        const output = {
          record_type: 'Company',
          summary: {
            total_fields: allFields.length,
            required_count: requiredFields.length,
            fixed_fields: COMPANY_FIXED_FIELDS.length,
            custom_fields: customFieldSchemas.length
          },
          required_fields: requiredFields,
          optional_fields: allFields.filter(f => !f.required),
          usage_note: 'Create companies using create_contact with is_company=true',
          usage_example: `create_contact with: { name: "Acme Corp", is_company: true, assigned_to: "<user_id>" }`
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_pipeline_item_schema - Complete field schema for pipeline items
  server.registerTool(
    'get_pipeline_item_schema',
    {
      title: 'Get Pipeline Item Schema',
      description: `Get complete field schema for creating/editing pipeline items.

Requires pipeline_id because each pipeline has different custom fields.

Returns ALL fields (both fixed system fields and custom fields) with:
- name: The parameter name to use in create_pipeline_item/edit_pipeline_item
- required: Whether this field must be provided
- type: Field type (Text, Dropdown, etc.)
- input_format: Exact format expected for the value
- valid_options: For dropdowns, the exact values you can use
- is_custom_field: Whether this is a custom field (true) or built-in (false)

WORKFLOW:
1. Call get_pipelines to find the pipeline_id and its status_ids
2. Call get_pipeline_item_schema with the pipeline_id
3. Use the schema to construct a valid create_pipeline_item call`,
      inputSchema: {
        pipeline_id: z.string().describe('The PipelineId to get the schema for')
      }
    },
    async ({ pipeline_id }) => {
      try {
        const client = getClient();

        // Get custom fields for this pipeline
        const result = await client.call<{ Results?: CustomFieldDetail[]; HasMoreResults?: boolean } | CustomFieldDetail[]>(
          'GetCustomFields',
          { RecordType: 'Pipeline', PipelineId: pipeline_id }
        );

        const customFields = Array.isArray(result) ? result : (result.Results || []);

        // Convert custom fields to schema format
        const customFieldSchemas: SchemaField[] = customFields.map(field => ({
          name: field.Name,
          required: field.IsRequired || false,
          type: field.Type,
          input_format: getInputFormatDescription(field.Type),
          is_custom_field: true,
          field_id: field.CustomFieldId,
          valid_options: field.Options?.map(opt =>
            typeof opt === 'string' ? opt : (opt.Value || opt.Name || String(opt))
          )
        }));

        // Combine fixed and custom fields
        const allFields = [...PIPELINE_ITEM_FIXED_FIELDS, ...customFieldSchemas];
        const requiredFields = allFields.filter(f => f.required);

        // Build usage example
        const customFieldExample = customFieldSchemas
          .filter(f => f.required)
          .map(f => `"${f.name}": ${f.valid_options ? `"${f.valid_options[0]}"` : '"value"'}`)
          .join(', ');

        const output = {
          record_type: 'PipelineItem',
          pipeline_id,
          summary: {
            total_fields: allFields.length,
            required_count: requiredFields.length,
            fixed_fields: PIPELINE_ITEM_FIXED_FIELDS.length,
            custom_fields: customFieldSchemas.length
          },
          required_fields: requiredFields,
          optional_fields: allFields.filter(f => !f.required),
          usage_example: customFieldExample
            ? `create_pipeline_item with: { contact_id: "<id>", pipeline_id: "${pipeline_id}", status_id: "<status_id>", custom_fields: { ${customFieldExample} } }`
            : `create_pipeline_item with: { contact_id: "<id>", pipeline_id: "${pipeline_id}", status_id: "<status_id>" }`
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }]
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
