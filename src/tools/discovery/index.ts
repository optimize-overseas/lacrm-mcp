/**
 * Discovery Tools for LACRM MCP Server
 *
 * Tools that help the LLM discover the account structure before performing operations:
 * - get_custom_fields: Learn custom field IDs and types for contacts/pipelines
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
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

/**
 * Custom field definition returned by GetCustomFields
 */
interface CustomField {
  FieldId: string;
  Name: string;
  Type: string;
  Description?: string;
  Options?: string[];
}

interface CustomFieldsResponse {
  CustomFields: CustomField[];
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

interface PipelinesResponse {
  Pipelines: Pipeline[];
}

/**
 * Group definition returned by GetGroups
 */
interface Group {
  GroupId: string;
  Name: string;
  Description?: string;
}

interface GroupsResponse {
  Groups: Group[];
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

interface UsersResponse {
  Users: User[];
}

/**
 * Calendar definition returned by GetCalendars
 */
interface Calendar {
  CalendarId: string;
  Name: string;
  UserId: string;
}

interface CalendarsResponse {
  Calendars: Calendar[];
}

export function registerDiscoveryTools(server: McpServer): void {
  // get_custom_fields
  server.registerTool(
    'get_custom_fields',
    {
      title: 'Get Custom Fields',
      description: `Retrieve all custom field definitions for this LACRM account.
Use this tool FIRST when you need to work with contacts or pipeline items that have custom fields.
Returns field IDs (like "Custom_3971579198060101921194362986880"), names, types, and options.

The field IDs returned are used when creating/editing contacts or reading custom field values.
Example workflow: Call get_custom_fields, note the field IDs, then use them in create_contact or edit_contact.`,
      inputSchema: {}
    },
    async () => {
      try {
        const client = getClient();
        const result = await client.call<CustomFieldsResponse>('GetCustomFields');
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

  // get_pipelines
  server.registerTool(
    'get_pipelines',
    {
      title: 'Get Pipelines',
      description: `Retrieve all pipeline definitions for this LACRM account.
Use this tool to discover available pipelines and their statuses before creating or editing pipeline items.
Returns pipeline IDs, names, icons, and status definitions with sort order.

Each pipeline has multiple statuses that represent stages (e.g., "Lead", "Qualified", "Closed").
Use the PipelineId and StatusId values when creating or editing pipeline items.`,
      inputSchema: {}
    },
    async () => {
      try {
        const client = getClient();
        const result = await client.call<PipelinesResponse>('GetPipelines');
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
        const result = await client.call<GroupsResponse>('GetGroups');
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
        const result = await client.call<UsersResponse>('GetUsers');
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
        const result = await client.call<CalendarsResponse>('GetCalendars');
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
