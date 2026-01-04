/**
 * Pipeline Item Tools for LACRM MCP Server
 *
 * Sales and workflow tracking:
 * - create_pipeline_item: Add contact to a pipeline
 * - edit_pipeline_item: Update status or custom fields
 * - delete_pipeline_item: Remove single item
 * - delete_pipeline_items_bulk: Batch delete (max 5000)
 * - get_pipeline_item: Retrieve single item
 * - search_pipeline_items: Find items with filters
 * - get_pipeline_items_attached_to_contact: List all pipelines for a contact
 *
 * Pipeline items track contacts through workflow stages.
 * Use get_pipelines first to discover pipeline IDs and status IDs.
 *
 * @module tools/pipeline-items
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

export function registerPipelineItemTools(server: McpServer): void {
  // create_pipeline_item
  server.registerTool(
    'create_pipeline_item',
    {
      title: 'Create Pipeline Item',
      description: `Create a new pipeline item attached to a contact in Less Annoying CRM.

PREREQUISITES (call these first):
1. get_pipelines → find pipeline_id and valid status_ids
2. get_pipeline_item_schema(pipeline_id) → see required custom fields and their valid options
3. search_contacts → find/verify valid contact_id

Pipeline items track contacts through sales stages or workflows.
Optionally run status automation when creating (e.g., send emails, create tasks).`,
      inputSchema: {
        contact_id: z.string().describe('Contact or company ID to attach the item to'),
        pipeline_id: z.string().describe('Pipeline ID (from get_pipelines)'),
        status_id: z.string().describe('Initial status ID (from get_pipelines)'),
        note: z.string().optional().describe('Historical note for the item'),
        run_automation: z.boolean().optional().describe('Run status automation (default: false)'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom pipeline field values')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          ContactId: args.contact_id,
          PipelineId: args.pipeline_id,
          StatusId: args.status_id
        };

        if (args.note) params.Note = args.note;
        if (args.run_automation !== undefined) params.RunStatusAutomation = args.run_automation;
        if (args.custom_fields) Object.assign(params, args.custom_fields);

        const result = await client.call<{ PipelineItemId: string }>('CreatePipelineItem', params);
        return {
          content: [{ type: 'text' as const, text: `Pipeline item created successfully. PipelineItemId: ${result.PipelineItemId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_pipeline_item
  server.registerTool(
    'edit_pipeline_item',
    {
      title: 'Edit Pipeline Item',
      description: `Update an existing pipeline item in Less Annoying CRM.

PREREQUISITES (call these first):
1. get_pipeline_item_schema(pipeline_id) → see available custom fields and their valid options
2. search_pipeline_items or get_pipeline_item → find/verify valid pipeline_item_id
3. get_pipelines → find valid status_ids (if changing status)

Use this to change status, add notes, or update custom field values.`,
      inputSchema: {
        pipeline_item_id: z.string().describe('The PipelineItemId to edit'),
        status_id: z.string().optional().describe('New status ID'),
        note: z.string().optional().describe('Add a historical note'),
        run_automation: z.boolean().optional().describe('Run status automation (default: false)'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom field values to update')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          PipelineItemId: args.pipeline_item_id
        };

        if (args.status_id !== undefined) params.StatusId = args.status_id;
        if (args.note !== undefined) params.Note = args.note;
        if (args.run_automation !== undefined) params.RunStatusAutomation = args.run_automation;
        if (args.custom_fields) Object.assign(params, args.custom_fields);

        await client.call('EditPipelineItem', params);
        return {
          content: [{ type: 'text' as const, text: `Pipeline item ${args.pipeline_item_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_pipeline_item
  server.registerTool(
    'delete_pipeline_item',
    {
      title: 'Delete Pipeline Item',
      description: `Delete a single pipeline item from Less Annoying CRM.
WARNING: This permanently removes the item.

Required: pipeline_item_id.`,
      inputSchema: {
        pipeline_item_id: z.string().describe('The PipelineItemId to delete')
      }
    },
    async ({ pipeline_item_id }) => {
      try {
        const client = getClient();
        await client.call('DeletePipelineItem', { PipelineItemId: pipeline_item_id });
        return {
          content: [{ type: 'text' as const, text: `Pipeline item ${pipeline_item_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_pipeline_items_bulk
  server.registerTool(
    'delete_pipeline_items_bulk',
    {
      title: 'Delete Pipeline Items (Bulk)',
      description: `Delete multiple pipeline items at once from Less Annoying CRM.
All items must belong to the same pipeline.
Maximum 5000 items per call.

Returns count of processed and skipped items.`,
      inputSchema: {
        pipeline_item_ids: z.array(z.string()).describe('Array of PipelineItemIds to delete (max 5000)'),
        pipeline_id: z.string().describe('Pipeline ID that all items belong to')
      }
    },
    async ({ pipeline_item_ids, pipeline_id }) => {
      try {
        const client = getClient();
        const result = await client.call<{ NumberProcessed: number; NumberSkipped: number }>(
          'DeletePipelineItems',
          { PipelineItemIds: pipeline_item_ids, PipelineId: pipeline_id }
        );
        return {
          content: [{ type: 'text' as const, text: `Bulk delete complete. Processed: ${result.NumberProcessed}, Skipped: ${result.NumberSkipped}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_pipeline_item
  server.registerTool(
    'get_pipeline_item',
    {
      title: 'Get Pipeline Item',
      description: `Retrieve a single pipeline item by ID.
Returns complete item details including status, contact info, and custom field values.`,
      inputSchema: {
        pipeline_item_id: z.string().describe('The PipelineItemId to retrieve')
      }
    },
    async ({ pipeline_item_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetPipelineItem', { PipelineItemId: pipeline_item_id });
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

  // search_pipeline_items
  server.registerTool(
    'search_pipeline_items',
    {
      title: 'Search Pipeline Items',
      description: `Search for pipeline items within a specific pipeline.
Use this to find items by status, user, or custom field values.

Required: pipeline_id (use get_pipelines to find valid IDs).
Supports advanced filters for custom fields.`,
      inputSchema: {
        pipeline_id: z.string().describe('Pipeline ID to search within'),
        user_filter: z.array(z.string()).optional().describe('Filter by creator user IDs'),
        status_filter: z.array(z.string()).optional().describe('Filter by status IDs'),
        sort_by: z.enum(['Status', 'DateCreated', 'LastUpdate']).optional(),
        sort_direction: z.enum(['Ascending', 'Descending']).optional(),
        max_results: z.number().optional().describe('Max results (default 500, max 10000)'),
        page: z.number().optional().describe('Page number for pagination'),
        advanced_filters: z.array(z.object({
          Name: z.string().describe('Field name to filter on (use get_pipeline_item_schema to see available fields)'),
          Operation: z.enum([
            // Text field operations
            'Contains',
            'DoesNotContain',
            'IsExactly',
            'IsNot',
            'IsEmpty',
            'IsNotEmpty',
            // Date field operations
            'IsBetween',
            'IsBefore',
            'IsAfter',
            // Numeric field operations
            'IsGreaterThan',
            'IsLessThan'
          ]).describe(`Filter operation. Valid operations depend on field type:
- Text fields: Contains, DoesNotContain, IsExactly, IsNot, IsEmpty, IsNotEmpty
- Date fields: IsExactly, IsBetween, IsBefore, IsAfter
- Numeric fields: IsExactly, IsGreaterThan, IsLessThan, Contains, IsEmpty, IsNotEmpty`),
          Value: z.unknown().describe('Value to filter by. Type depends on operation: Text for text ops, Date (YYYY-MM-DD) for date ops, {StartDate, EndDate} for IsBetween, null for IsEmpty/IsNotEmpty')
        })).optional().describe('Advanced field filters. Call get_pipeline_item_schema first to see available field names.')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          PipelineId: args.pipeline_id
        };

        if (args.user_filter) params.UserFilter = args.user_filter;
        if (args.status_filter) params.StatusFilter = args.status_filter;
        if (args.sort_by) params.SortBy = args.sort_by;
        if (args.sort_direction) params.SortDirection = args.sort_direction;
        if (args.max_results) params.MaxNumberOfResults = args.max_results;
        if (args.page) params.Page = args.page;
        if (args.advanced_filters) params.AdvancedFilters = args.advanced_filters;

        const result = await client.call('GetPipelineItems', params);
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

  // get_pipeline_items_attached_to_contact
  server.registerTool(
    'get_pipeline_items_attached_to_contact',
    {
      title: 'Get Pipeline Items For Contact',
      description: `Retrieve all pipeline items for a specific contact.
Returns items across all pipelines that the contact is in.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId to get pipeline items for'),
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

        const result = await client.call('GetPipelineItemsAttachedToContact', params);
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
