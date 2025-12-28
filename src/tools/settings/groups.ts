/**
 * Group Settings Tools for LACRM MCP Server
 *
 * Manage contact group definitions:
 * - create_group: Create new group with sharing settings
 * - edit_group: Update group name, sharing, or color
 * - delete_group: Remove group (contacts not deleted)
 * - get_group: Retrieve single group definition
 *
 * Sharing options: Public (all users), Private (creator only), Teams
 *
 * @module tools/settings/groups
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

const colorEnum = z.enum([
  'Blue', 'LightBlue', 'Cyan', 'Teal', 'Green', 'LimeGreen',
  'Yellow', 'Orange', 'Red', 'Pink', 'Magenta', 'Purple', 'Indigo', 'Gray'
]);

const sharingEnum = z.enum(['Public', 'Private', 'Teams']);

export function registerGroupSettingsTools(server: McpServer): void {
  // create_group
  server.registerTool(
    'create_group',
    {
      title: 'Create Group',
      description: `Create a new group in Less Annoying CRM.
Groups are used to segment contacts for easy retrieval.

Sharing options:
- Public: Visible to all users
- Private: Only visible to creator
- Teams: Visible to specified teams (requires team_ids)`,
      inputSchema: {
        name: z.string().describe('Unique group name'),
        sharing: sharingEnum.optional().describe('Public, Private, or Teams (default: Private)'),
        team_ids: z.array(z.string()).optional().describe('Team IDs when sharing is Teams'),
        color: colorEnum.optional().describe('Group color for visual identification')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { Name: args.name };
        if (args.sharing) params.Sharing = args.sharing;
        if (args.team_ids) params.TeamIds = args.team_ids;
        if (args.color) params.Color = args.color;

        const result = await client.call<{ GroupId: string }>('CreateGroup', params);
        return {
          content: [{ type: 'text' as const, text: `Group created successfully. GroupId: ${result.GroupId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_group
  server.registerTool(
    'edit_group',
    {
      title: 'Edit Group',
      description: `Update an existing group's properties.
Use get_groups to find group IDs first.`,
      inputSchema: {
        group_id: z.string().describe('The GroupId to edit'),
        name: z.string().optional().describe('Updated group name'),
        sharing: sharingEnum.optional().describe('Updated sharing setting'),
        team_ids: z.array(z.string()).optional().describe('Updated team IDs'),
        color: colorEnum.optional().describe('Updated group color')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { GroupId: args.group_id };
        if (args.name) params.Name = args.name;
        if (args.sharing) params.Sharing = args.sharing;
        if (args.team_ids) params.TeamIds = args.team_ids;
        if (args.color) params.Color = args.color;

        await client.call('EditGroup', params);
        return {
          content: [{ type: 'text' as const, text: `Group ${args.group_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_group
  server.registerTool(
    'delete_group',
    {
      title: 'Delete Group',
      description: `Delete a group from the account.
WARNING: This removes the group but does not delete the contacts in it.`,
      inputSchema: {
        group_id: z.string().describe('The GroupId to delete')
      }
    },
    async ({ group_id }) => {
      try {
        const client = getClient();
        await client.call('DeleteGroup', { GroupId: group_id });
        return {
          content: [{ type: 'text' as const, text: `Group ${group_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_group
  server.registerTool(
    'get_group',
    {
      title: 'Get Group',
      description: `Get details for a single group.
Returns group name, sharing settings, team IDs, and color.
Does not include contact membership data - use get_contacts_in_group for that.`,
      inputSchema: {
        group_id: z.string().describe('The GroupId to retrieve')
      }
    },
    async ({ group_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetGroup', { GroupId: group_id });
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
