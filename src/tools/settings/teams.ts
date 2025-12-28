/**
 * Team Settings Tools for LACRM MCP Server
 *
 * Manage team definitions:
 * - create_team: Create new team with optional members
 * - edit_team: Update team name or membership
 * - delete_team: Remove team (users not deleted)
 * - get_team: Retrieve single team definition
 * - get_teams: List all accessible teams
 *
 * Teams are used for permission management with groups and pipelines.
 * Editing membership replaces the entire member list.
 *
 * @module tools/settings/teams
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

export function registerTeamSettingsTools(server: McpServer): void {
  // create_team
  server.registerTool(
    'create_team',
    {
      title: 'Create Team',
      description: `Create a new team in Less Annoying CRM.
Teams organize users for permission management.
Use get_users first to find user IDs for team membership.`,
      inputSchema: {
        name: z.string().describe('Team display name'),
        user_ids: z.array(z.string()).optional().describe('User IDs to add to team')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { Name: args.name };
        if (args.user_ids) params.UserIdList = args.user_ids;

        const result = await client.call<{ TeamId: string }>('CreateTeam', params);
        return {
          content: [{ type: 'text' as const, text: `Team created successfully. TeamId: ${result.TeamId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_team
  server.registerTool(
    'edit_team',
    {
      title: 'Edit Team',
      description: `Update a team's name and/or membership.
Use get_teams to find team IDs first.

Note: Passing user_ids completely replaces team membership.
Pass empty array to remove all users.`,
      inputSchema: {
        team_id: z.string().describe('The TeamId to edit'),
        name: z.string().optional().describe('Updated team name'),
        user_ids: z.array(z.string()).optional().describe('New team member list (replaces existing)')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { TeamId: args.team_id };
        if (args.name) params.Name = args.name;
        if (args.user_ids !== undefined) params.UserIdList = args.user_ids;

        await client.call('EditTeam', params);
        return {
          content: [{ type: 'text' as const, text: `Team ${args.team_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_team
  server.registerTool(
    'delete_team',
    {
      title: 'Delete Team',
      description: `Delete a team from the account.
Only account owners and administrators can delete teams.
WARNING: This removes the team but does not affect the users in it.`,
      inputSchema: {
        team_id: z.string().describe('The TeamId to delete')
      }
    },
    async ({ team_id }) => {
      try {
        const client = getClient();
        await client.call('DeleteTeam', { TeamId: team_id });
        return {
          content: [{ type: 'text' as const, text: `Team ${team_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_team
  server.registerTool(
    'get_team',
    {
      title: 'Get Team',
      description: `Get detailed information about a single team.
Returns team name, creation date, and member user IDs.`,
      inputSchema: {
        team_id: z.string().describe('The TeamId to retrieve')
      }
    },
    async ({ team_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetTeam', { TeamId: team_id });
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

  // get_teams
  server.registerTool(
    'get_teams',
    {
      title: 'Get Teams',
      description: `Get all teams accessible to the current user.
Admins see all account teams; regular users only see teams they belong to.`,
      inputSchema: {}
    },
    async () => {
      try {
        const client = getClient();
        const result = await client.call('GetTeams', {});
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
