/**
 * Group Membership Tools for LACRM MCP Server
 *
 * Manage contact group assignments:
 * - add_contact_to_group: Add contact to a group
 * - remove_contact_from_group: Remove contact from a group
 * - get_groups_for_contact: List all groups a contact belongs to
 * - get_contacts_in_group: List all contacts in a group
 *
 * Groups can be identified by either group_id or group_name.
 * Use get_groups to discover available groups first.
 *
 * @module tools/groups
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

export function registerGroupMembershipTools(server: McpServer): void {
  // add_contact_to_group
  server.registerTool(
    'add_contact_to_group',
    {
      title: 'Add Contact to Group',
      description: `Add a contact to a group in Less Annoying CRM.
Use either group_id or group_name to identify the group (not both).

Use get_groups to find valid group IDs.`,
      inputSchema: {
        contact_id: z.string().describe('Contact or company ID to add to group'),
        group_id: z.string().optional().describe('Group ID (preferred over group_name)'),
        group_name: z.string().optional().describe('Group name (alternative to group_id)')
      }
    },
    async (args) => {
      try {
        if (!args.group_id && !args.group_name) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Either group_id or group_name is required' }],
            isError: true
          };
        }
        if (args.group_id && args.group_name) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Use either group_id or group_name, not both' }],
            isError: true
          };
        }

        const client = getClient();

        const params: Record<string, unknown> = { ContactId: args.contact_id };
        if (args.group_id) params.GroupId = args.group_id;
        if (args.group_name) params.GroupName = args.group_name;

        await client.call('CreateGroupMembership', params);
        return {
          content: [{ type: 'text' as const, text: `Contact ${args.contact_id} added to group successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // remove_contact_from_group
  server.registerTool(
    'remove_contact_from_group',
    {
      title: 'Remove Contact from Group',
      description: `Remove a contact from a group in Less Annoying CRM.
Use either group_id or group_name to identify the group (not both).`,
      inputSchema: {
        contact_id: z.string().describe('Contact or company ID to remove from group'),
        group_id: z.string().optional().describe('Group ID (preferred over group_name)'),
        group_name: z.string().optional().describe('Group name (alternative to group_id)')
      }
    },
    async (args) => {
      try {
        if (!args.group_id && !args.group_name) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Either group_id or group_name is required' }],
            isError: true
          };
        }
        if (args.group_id && args.group_name) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Use either group_id or group_name, not both' }],
            isError: true
          };
        }

        const client = getClient();

        const params: Record<string, unknown> = { ContactId: args.contact_id };
        if (args.group_id) params.GroupId = args.group_id;
        if (args.group_name) params.GroupName = args.group_name;

        await client.call('DeleteGroupMembership', params);
        return {
          content: [{ type: 'text' as const, text: `Contact ${args.contact_id} removed from group successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_groups_for_contact
  server.registerTool(
    'get_groups_for_contact',
    {
      title: 'Get Groups For Contact',
      description: `Retrieve all groups a contact belongs to.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId to get groups for'),
        max_results: z.number().optional().describe('Max results (default 500)'),
        page: z.number().optional().describe('Page number for pagination')
      }
    },
    async ({ contact_id, max_results, page }) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { ContactId: contact_id };
        if (max_results) params.MaxNumberOfResults = max_results;
        if (page) params.Page = page;

        const result = await client.call('GetGroupsAttachedToContact', params);
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

  // get_contacts_in_group
  server.registerTool(
    'get_contacts_in_group',
    {
      title: 'Get Contacts in Group',
      description: `Retrieve all contacts that belong to a specific group.
Use either group_id or group_name to identify the group (not both).`,
      inputSchema: {
        group_id: z.string().optional().describe('Group ID (preferred over group_name)'),
        group_name: z.string().optional().describe('Group name (alternative to group_id)'),
        max_results: z.number().optional().describe('Max results (default 500)'),
        page: z.number().optional().describe('Page number for pagination')
      }
    },
    async (args) => {
      try {
        if (!args.group_id && !args.group_name) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Either group_id or group_name is required' }],
            isError: true
          };
        }
        if (args.group_id && args.group_name) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Use either group_id or group_name, not both' }],
            isError: true
          };
        }

        const client = getClient();

        const params: Record<string, unknown> = {};
        if (args.group_id) params.GroupId = args.group_id;
        if (args.group_name) params.GroupName = args.group_name;
        if (args.max_results) params.MaxNumberOfResults = args.max_results;
        if (args.page) params.Page = args.page;

        const result = await client.call('GetContactsInGroup', params);
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
