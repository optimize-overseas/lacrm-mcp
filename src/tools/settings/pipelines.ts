/**
 * Pipeline Settings Tools for LACRM MCP Server
 *
 * Manage pipeline definitions:
 * - create_pipeline: Create new pipeline with icon and permissions
 * - edit_pipeline: Update pipeline name, icon, or permissions
 * - delete_pipeline: Remove pipeline configuration
 * - get_pipeline: Retrieve single pipeline definition with statuses
 *
 * Permissions: Public (all users), TeamSharing (specified teams only)
 *
 * @module tools/settings/pipelines
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

const permissionsEnum = z.enum(['Public', 'TeamSharing']);

export function registerPipelineSettingsTools(server: McpServer): void {
  // create_pipeline
  server.registerTool(
    'create_pipeline',
    {
      title: 'Create Pipeline',
      description: `Create a new pipeline in Less Annoying CRM.
Pipelines track deals, opportunities, or any workflow with stages.

Permissions:
- Public: Visible to all users
- TeamSharing: Only visible to specified teams (requires team_ids)`,
      inputSchema: {
        name: z.string().describe('Pipeline display name'),
        icon: z.string().describe('Pipeline icon name (see Pipeline Icons documentation)'),
        permissions: permissionsEnum.optional().describe('Public or TeamSharing (default: Public)'),
        team_ids: z.array(z.string()).optional().describe('Team IDs for TeamSharing permission')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          Name: args.name,
          Icon: args.icon
        };
        if (args.permissions) params.Permissions = args.permissions;
        if (args.team_ids) params.TeamIds = args.team_ids;

        const result = await client.call<{ PipelineId: string }>('CreatePipeline', params);
        return {
          content: [{ type: 'text' as const, text: `Pipeline created successfully. PipelineId: ${result.PipelineId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_pipeline
  server.registerTool(
    'edit_pipeline',
    {
      title: 'Edit Pipeline',
      description: `Update an existing pipeline's configuration.
Use get_pipelines to find pipeline IDs first.`,
      inputSchema: {
        pipeline_id: z.string().describe('The PipelineId to edit'),
        name: z.string().optional().describe('Updated pipeline name'),
        icon: z.string().optional().describe('Updated pipeline icon'),
        permissions: permissionsEnum.optional().describe('Updated permissions'),
        team_ids: z.array(z.string()).optional().describe('Updated team IDs')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { PipelineId: args.pipeline_id };
        if (args.name) params.Name = args.name;
        if (args.icon) params.Icon = args.icon;
        if (args.permissions) params.Permissions = args.permissions;
        if (args.team_ids) params.TeamIds = args.team_ids;

        await client.call('EditPipeline', params);
        return {
          content: [{ type: 'text' as const, text: `Pipeline ${args.pipeline_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_pipeline
  server.registerTool(
    'delete_pipeline',
    {
      title: 'Delete Pipeline',
      description: `Delete a pipeline from the account.
WARNING: This permanently removes the pipeline configuration. Pipeline items may become orphaned.`,
      inputSchema: {
        pipeline_id: z.string().describe('The PipelineId to delete')
      }
    },
    async ({ pipeline_id }) => {
      try {
        const client = getClient();
        await client.call('DeletePipeline', { PipelineId: pipeline_id });
        return {
          content: [{ type: 'text' as const, text: `Pipeline ${pipeline_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_pipeline
  server.registerTool(
    'get_pipeline',
    {
      title: 'Get Pipeline',
      description: `Get detailed information about a single pipeline configuration.
Returns pipeline name, icon, statuses, permissions, and sharing settings.
Does not return pipeline items - use search_pipeline_items for that.`,
      inputSchema: {
        pipeline_id: z.string().describe('The PipelineId to retrieve')
      }
    },
    async ({ pipeline_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetPipeline', { PipelineId: pipeline_id });
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
