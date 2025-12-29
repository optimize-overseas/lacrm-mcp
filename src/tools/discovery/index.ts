/**
 * Discovery Tools for LACRM MCP Server
 *
 * Tools that help the LLM discover the account structure before performing operations:
 * - get_custom_fields: Learn custom field IDs, types, requirements for contacts/pipelines
 * - get_pipeline_custom_fields: Get custom fields for a specific pipeline (convenience tool)
 * - get_pipelines: Discover pipelines and their statuses
 * - get_groups: Find available contact groups
 * - get_users: List users for assignment and filtering
 * - get_calendars: Discover calendars for event creation
 *
 * Recommended workflow: Call these tools first to understand the account
 * configuration before creating or modifying records.
 *
 * @module tools/discovery
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

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

export function registerDiscoveryTools(server: McpServer): void {
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
}
