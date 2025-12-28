/**
 * Pipeline Status Settings Tools for LACRM MCP Server
 *
 * Manage pipeline status definitions:
 * - create_pipeline_status: Add new status to a pipeline
 * - edit_pipeline_status: Update status name, active state, or color
 * - delete_pipeline_status: Remove status definition
 * - get_pipeline_statuses: List all statuses for a pipeline
 *
 * Statuses can be active (in-progress) or closed (completed).
 * Colors can be named colors or hex codes.
 *
 * @module tools/settings/pipeline-statuses
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

export function registerPipelineStatusSettingsTools(server: McpServer): void {
  // create_pipeline_status
  server.registerTool(
    'create_pipeline_status',
    {
      title: 'Create Pipeline Status',
      description: `Create a new status for an existing pipeline.
Statuses represent stages in your pipeline workflow.

is_active:
- true: Status represents an active/in-progress stage
- false: Status represents a closed/completed stage

Colors: Blue, LightBlue, Cyan, Teal, Green, LimeGreen, Yellow, Orange, Red, Pink, Magenta, Purple, Indigo, Gray, or hex codes like #486581`,
      inputSchema: {
        pipeline_id: z.string().describe('Pipeline to add status to'),
        name: z.string().describe('Status label'),
        is_active: z.boolean().optional().describe('Active status (true) or closed status (false, default)'),
        color: z.string().optional().describe('Named color or hex code')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          PipelineId: args.pipeline_id,
          Name: args.name
        };
        if (args.is_active !== undefined) params.IsActive = args.is_active;
        if (args.color) params.Color = args.color;

        const result = await client.call<{ StatusId: string }>('CreatePipelineStatus', params);
        return {
          content: [{ type: 'text' as const, text: `Pipeline status created successfully. StatusId: ${result.StatusId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_pipeline_status
  server.registerTool(
    'edit_pipeline_status',
    {
      title: 'Edit Pipeline Status',
      description: `Update an existing pipeline status.
This modifies the status definition, not individual pipeline items.
Only include fields you want to change.
Use get_pipeline_statuses to find status IDs.`,
      inputSchema: {
        status_id: z.string().describe('The StatusId to edit'),
        name: z.string().optional().describe('Updated status label'),
        is_active: z.boolean().optional().describe('Updated active/closed setting'),
        color: z.string().optional().describe('Updated color')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          StatusId: args.status_id
        };
        if (args.name !== undefined) params.Name = args.name;
        if (args.is_active !== undefined) params.IsActive = args.is_active;
        if (args.color) params.Color = args.color;

        await client.call('EditPipelineStatus', params);
        return {
          content: [{ type: 'text' as const, text: `Pipeline status ${args.status_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_pipeline_status
  server.registerTool(
    'delete_pipeline_status',
    {
      title: 'Delete Pipeline Status',
      description: `Delete a pipeline status.
WARNING: Pipeline items using this status may become orphaned.`,
      inputSchema: {
        status_id: z.string().describe('The StatusId to delete')
      }
    },
    async ({ status_id }) => {
      try {
        const client = getClient();
        await client.call('DeletePipelineStatus', { StatusId: status_id });
        return {
          content: [{ type: 'text' as const, text: `Pipeline status ${status_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_pipeline_statuses
  server.registerTool(
    'get_pipeline_statuses',
    {
      title: 'Get Pipeline Statuses',
      description: `Get all statuses for a specific pipeline or all pipelines.
Returns status IDs, names, active/closed state, colors, and creation dates.`,
      inputSchema: {
        pipeline_id: z.string().optional().describe('Filter by pipeline (omit for all statuses)')
      }
    },
    async ({ pipeline_id }) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {};
        if (pipeline_id) params.PipelineId = pipeline_id;

        const result = await client.call('GetPipelineStatuses', params);
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
