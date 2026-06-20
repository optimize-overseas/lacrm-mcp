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
import { summarizeResults } from '../../utils/summarize.js';
import { resolveStatusNames, resolveUserNames, resolveCustomFieldNames } from '../../utils/resolve-names.js';
import { countAll } from '../../utils/count-all.js';

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
Optionally run status automation when creating (e.g., send emails, create tasks).

Supports name-based resolution: use status_name instead of status_id, and custom_field_names instead of custom_fields.`,
      inputSchema: {
        contact_id: z.string().describe('Contact or company ID to attach the item to'),
        pipeline_id: z.string().describe('Pipeline ID (from get_pipelines)'),
        status_id: z.string().optional().describe('Initial status ID (from get_pipelines). Mutually exclusive with status_name.'),
        status_name: z.string().optional().describe('Initial status name (case-insensitive, auto-resolved to ID). Mutually exclusive with status_id.'),
        note: z.string().optional().describe('Historical note for the item'),
        run_automation: z.boolean().optional().describe('Run status automation (default: false)'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom pipeline field values keyed by field NAME, written verbatim (LACRM v2 ignores ID-keyed writes). Prefer custom_field_names for validated writes. Mutually exclusive with custom_field_names.'),
        custom_field_names: z.record(z.unknown()).optional().describe('Custom pipeline field values keyed by field name (case-insensitive; validated against the pipeline fields + dropdown options, then written by name). Mutually exclusive with custom_fields.')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        // Validation: must provide status_id or status_name, not both
        if (args.status_id && args.status_name) {
          throw new Error('Use status_id or status_name, not both');
        }
        if (!args.status_id && !args.status_name) {
          throw new Error('Either status_id or status_name is required');
        }
        if (args.custom_fields && args.custom_field_names) {
          throw new Error('Use custom_fields or custom_field_names, not both');
        }

        // Resolve status name to ID
        let statusId = args.status_id;
        if (args.status_name) {
          const resolved = await resolveStatusNames(client, args.pipeline_id, [args.status_name]);
          statusId = resolved[0];
        }

        const params: Record<string, unknown> = {
          ContactId: args.contact_id,
          PipelineId: args.pipeline_id,
          StatusId: statusId
        };

        if (args.note) params.Note = args.note;
        if (args.run_automation !== undefined) params.RunStatusAutomation = args.run_automation;

        // Resolve custom field names to IDs
        if (args.custom_field_names) {
          const resolvedFields = await resolveCustomFieldNames(client, args.custom_field_names, 'Pipeline', args.pipeline_id);
          Object.assign(params, resolvedFields);
        } else if (args.custom_fields) {
          Object.assign(params, args.custom_fields);
        }

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

Use this to change status, add notes, or update custom field values.
Supports name-based resolution: use status_name instead of status_id, and custom_field_names instead of custom_fields.`,
      inputSchema: {
        pipeline_item_id: z.string().describe('The PipelineItemId to edit'),
        pipeline_id: z.string().optional().describe('Pipeline ID (required when using status_name or custom_field_names for resolution)'),
        status_id: z.string().optional().describe('New status ID. Mutually exclusive with status_name.'),
        status_name: z.string().optional().describe('New status name (case-insensitive, auto-resolved to ID). Mutually exclusive with status_id. Requires pipeline_id.'),
        note: z.string().optional().describe('Add a historical note'),
        run_automation: z.boolean().optional().describe('Run status automation (default: false)'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom field values to update keyed by field NAME, written verbatim (LACRM v2 ignores ID-keyed writes). Prefer custom_field_names. Mutually exclusive with custom_field_names.'),
        custom_field_names: z.record(z.unknown()).optional().describe('Custom field values keyed by field name (case-insensitive; validated + written by name). Mutually exclusive with custom_fields. Requires pipeline_id.')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        // Validation
        if (args.status_id && args.status_name) {
          throw new Error('Use status_id or status_name, not both');
        }
        if (args.status_name && !args.pipeline_id) {
          throw new Error('pipeline_id is required when using status_name');
        }
        if (args.custom_fields && args.custom_field_names) {
          throw new Error('Use custom_fields or custom_field_names, not both');
        }
        if (args.custom_field_names && !args.pipeline_id) {
          throw new Error('pipeline_id is required when using custom_field_names');
        }

        const params: Record<string, unknown> = {
          PipelineItemId: args.pipeline_item_id
        };

        // Resolve status name to ID
        if (args.status_name) {
          const resolved = await resolveStatusNames(client, args.pipeline_id!, [args.status_name]);
          params.StatusId = resolved[0];
        } else if (args.status_id !== undefined) {
          params.StatusId = args.status_id;
        }

        if (args.note !== undefined) params.Note = args.note;
        if (args.run_automation !== undefined) params.RunStatusAutomation = args.run_automation;

        // Resolve custom field names to IDs
        if (args.custom_field_names) {
          const resolvedFields = await resolveCustomFieldNames(client, args.custom_field_names, 'Pipeline', args.pipeline_id);
          Object.assign(params, resolvedFields);
        } else if (args.custom_fields) {
          Object.assign(params, args.custom_fields);
        }

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
Use this when you already have a PipelineItemId and need the record.

NOTE: search_pipeline_items returns the same full data for each match. Only use get_pipeline_item when you have an ID but not the data.`,
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

RETURNS FULL DATA: Each result includes all pipeline item fields (status, contact info, custom fields, timestamps, etc.) - no need to call get_pipeline_item afterward.

Required: pipeline_id (use get_pipelines to find valid IDs).
Supports advanced filters for custom fields.
Supports name-based filters: use status_name_filter or user_name_filter instead of IDs.
Use count_only=true for accurate counts on large datasets without returning the full result set.`,
      inputSchema: {
        pipeline_id: z.string().describe('Pipeline ID to search within'),
        user_filter: z.array(z.string()).optional().describe('Filter by creator user IDs. Mutually exclusive with user_name_filter.'),
        user_name_filter: z.array(z.string()).optional().describe('Filter by user names (case-insensitive, auto-resolved to IDs). Mutually exclusive with user_filter.'),
        status_filter: z.array(z.string()).optional().describe('Filter by status IDs. Mutually exclusive with status_name_filter.'),
        status_name_filter: z.array(z.string()).optional().describe('Filter by status names (case-insensitive, auto-resolved to IDs). Mutually exclusive with status_filter.'),
        sort_by: z.enum(['Status', 'DateCreated', 'LastUpdate']).optional(),
        sort_direction: z.enum(['Ascending', 'Descending']).optional(),
        max_results: z.number().optional().describe('Max results (default 500, max 10000)'),
        page: z.number().optional().describe('Page number for pagination'),
        count_only: z.boolean().optional().describe('When true, auto-paginates and returns only total count and breakdowns (no results array). Use for accurate counts on large datasets.'),
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
            'IsExactly',
            'IsBetween',
            'IsBefore',
            'IsAfter',
            // Numeric field operations
            'IsExactly',
            'IsGreaterThan',
            'IsLessThan',
            'Contains',
            'IsEmpty',
            'IsNotEmpty'
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

        // Validation: mutually exclusive filters
        if (args.status_filter && args.status_name_filter) {
          throw new Error('Use status_filter or status_name_filter, not both');
        }
        if (args.user_filter && args.user_name_filter) {
          throw new Error('Use user_filter or user_name_filter, not both');
        }

        // Resolve name-based filters to IDs
        let statusFilter = args.status_filter;
        if (args.status_name_filter) {
          statusFilter = await resolveStatusNames(client, args.pipeline_id, args.status_name_filter);
        }
        let userFilter = args.user_filter;
        if (args.user_name_filter) {
          userFilter = await resolveUserNames(client, args.user_name_filter);
        }

        const params: Record<string, unknown> = {
          PipelineId: args.pipeline_id
        };

        if (userFilter) params.UserFilter = userFilter;
        if (statusFilter) params.StatusFilter = statusFilter;
        if (args.sort_by) params.SortBy = args.sort_by;
        if (args.sort_direction) params.SortDirection = args.sort_direction;
        if (args.max_results) params.MaxNumberOfResults = args.max_results;
        if (args.page) params.Page = args.page;
        if (args.advanced_filters) params.AdvancedFilters = args.advanced_filters;

        // count_only mode: auto-paginate and return just summary
        if (args.count_only) {
          const countResult = await countAll(client, 'GetPipelineItems', params, [
            { label: 'by_status', path: 'StatusMetaData.Name' }
          ]);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(countResult, null, 2) }]
          };
        }

        const result = await client.call<{ Results?: unknown[]; HasMoreResults?: boolean }>('GetPipelineItems', params);
        const items = Array.isArray(result) ? result : (result.Results || []);
        const hasMore = !Array.isArray(result) && result.HasMoreResults === true;
        return {
          content: [{
            type: 'text' as const,
            text: summarizeResults(items, hasMore, [
              { label: 'by_status', path: 'StatusMetaData.Name' }
            ])
          }]
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
RETURNS FULL DATA: Each result includes all pipeline item fields - no need to call get_pipeline_item afterward.
Returns items across all pipelines that the contact is in.
Use count_only=true for accurate counts without returning the full result set.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId to get pipeline items for'),
        max_results: z.number().optional().describe('Max results (default 500)'),
        page: z.number().optional().describe('Page number for pagination'),
        count_only: z.boolean().optional().describe('When true, auto-paginates and returns only total count and breakdowns (no results array).')
      }
    },
    async ({ contact_id, max_results, page, count_only }) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { ContactId: contact_id };
        if (max_results) params.MaxNumberOfResults = max_results;
        if (page) params.Page = page;

        // count_only mode
        if (count_only) {
          const countResult = await countAll(client, 'GetPipelineItemsAttachedToContact', params, [
            { label: 'by_pipeline', path: 'PipelineMetaData.Name' },
            { label: 'by_status', path: 'StatusMetaData.Name' }
          ]);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(countResult, null, 2) }]
          };
        }

        const result = await client.call<{ Results?: unknown[]; HasMoreResults?: boolean }>('GetPipelineItemsAttachedToContact', params);
        const items = Array.isArray(result) ? result : (result.Results || []);
        const hasMore = !Array.isArray(result) && result.HasMoreResults === true;
        return {
          content: [{
            type: 'text' as const,
            text: summarizeResults(items, hasMore, [
              { label: 'by_pipeline', path: 'PipelineMetaData.Name' },
              { label: 'by_status', path: 'StatusMetaData.Name' }
            ])
          }]
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
