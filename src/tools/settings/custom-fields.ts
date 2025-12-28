/**
 * Custom Field Settings Tools for LACRM MCP Server
 *
 * Manage custom field definitions:
 * - create_custom_field: Add new custom field to contacts, companies, or pipelines
 * - edit_custom_field: Modify field name, options, or display settings
 * - delete_custom_field: Remove field definition (and all stored data!)
 * - get_custom_field: Retrieve single field definition
 *
 * Field types: Currency, Date, Dropdown, RadioList, Checkbox, Number, Text,
 * TextArea, ContactLink, FileLink, Signature, Section, SectionHeader, TextBlock
 *
 * @module tools/settings/custom-fields
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

const fieldTypeEnum = z.enum([
  'Currency', 'Date', 'Dropdown', 'RadioList', 'Checkbox',
  'Number', 'Text', 'TextArea', 'ContactLink', 'FileLink',
  'Signature', 'Section', 'SectionHeader', 'TextBlock'
]);

const recordTypeEnum = z.enum(['Contact', 'Company', 'Pipeline', 'PublicForm']);

export function registerCustomFieldSettingsTools(server: McpServer): void {
  // create_custom_field
  server.registerTool(
    'create_custom_field',
    {
      title: 'Create Custom Field',
      description: `Create a new custom field definition in Less Annoying CRM.
Use this to add new fields for contacts, companies, or pipelines.

Field types: Currency, Date, Dropdown, RadioList, Checkbox, Number, Text, TextArea, ContactLink, FileLink, Signature, Section, SectionHeader, TextBlock.

For Dropdown/RadioList/Checkbox fields, provide options array.
For Pipeline fields, pipeline_id is required.`,
      inputSchema: {
        name: z.string().describe('Field name'),
        type: fieldTypeEnum.describe('Field type'),
        record_type: recordTypeEnum.optional().describe('Contact, Company, Pipeline, or PublicForm'),
        pipeline_id: z.string().optional().describe('Required for pipeline fields'),
        is_required: z.boolean().optional().describe('Whether field is required'),
        options: z.array(z.string()).optional().describe('Options for Dropdown/RadioList/Checkbox fields'),
        show_on_active_badge: z.boolean().optional().describe('Show on active pipeline badges'),
        show_on_closed_badge: z.boolean().optional().describe('Show on closed pipeline badges'),
        show_on_report: z.boolean().optional().describe('Include in reports')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          Name: args.name,
          Type: args.type
        };

        if (args.record_type) params.RecordType = args.record_type;
        if (args.pipeline_id) params.PipelineId = args.pipeline_id;
        if (args.is_required !== undefined) params.IsRequired = args.is_required;
        if (args.options) params.Options = args.options;
        if (args.show_on_active_badge !== undefined) params.ShowOnActiveBadge = args.show_on_active_badge;
        if (args.show_on_closed_badge !== undefined) params.ShowOnClosedBadge = args.show_on_closed_badge;
        if (args.show_on_report !== undefined) params.ShowOnReport = args.show_on_report;

        const result = await client.call<{ CustomFieldId: string }>('CreateCustomField', params);
        return {
          content: [{ type: 'text' as const, text: `Custom field created successfully. CustomFieldId: ${result.CustomFieldId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_custom_field
  server.registerTool(
    'edit_custom_field',
    {
      title: 'Edit Custom Field',
      description: `Update an existing custom field definition.
Use get_custom_fields to find field IDs first.

Note: You cannot change the field type after creation.`,
      inputSchema: {
        custom_field_id: z.string().describe('The CustomFieldId to edit'),
        name: z.string().optional().describe('Updated field name'),
        is_required: z.boolean().optional().describe('Whether field is required'),
        options: z.array(z.string()).optional().describe('Updated options for Dropdown/RadioList/Checkbox'),
        show_on_active_badge: z.boolean().optional().describe('Show on active pipeline badges'),
        show_on_closed_badge: z.boolean().optional().describe('Show on closed pipeline badges'),
        show_on_report: z.boolean().optional().describe('Include in reports')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { CustomFieldId: args.custom_field_id };

        if (args.name) params.Name = args.name;
        if (args.is_required !== undefined) params.IsRequired = args.is_required;
        if (args.options) params.Options = args.options;
        if (args.show_on_active_badge !== undefined) params.ShowOnActiveBadge = args.show_on_active_badge;
        if (args.show_on_closed_badge !== undefined) params.ShowOnClosedBadge = args.show_on_closed_badge;
        if (args.show_on_report !== undefined) params.ShowOnReport = args.show_on_report;

        await client.call('EditCustomField', params);
        return {
          content: [{ type: 'text' as const, text: `Custom field ${args.custom_field_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_custom_field
  server.registerTool(
    'delete_custom_field',
    {
      title: 'Delete Custom Field',
      description: `Delete a custom field definition.
WARNING: This permanently removes the field and all data stored in it across all records.`,
      inputSchema: {
        custom_field_id: z.string().describe('The CustomFieldId to delete'),
        section_deletes_fields: z.boolean().optional().describe('If deleting a section, also delete nested fields')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { CustomFieldId: args.custom_field_id };
        if (args.section_deletes_fields !== undefined) params.SectionDeletesFields = args.section_deletes_fields;

        await client.call('DeleteCustomField', params);
        return {
          content: [{ type: 'text' as const, text: `Custom field ${args.custom_field_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_custom_field
  server.registerTool(
    'get_custom_field',
    {
      title: 'Get Custom Field',
      description: `Get detailed information about a single custom field definition.
Returns field name, type, options, display settings, and archived status.`,
      inputSchema: {
        custom_field_id: z.string().describe('The CustomFieldId to retrieve')
      }
    },
    async ({ custom_field_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetCustomField', { CustomFieldId: custom_field_id });
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
