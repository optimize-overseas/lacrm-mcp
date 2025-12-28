/**
 * Relationship Tools for LACRM MCP Server
 *
 * Manage connections between contacts:
 * - create_relationship: Link two contacts with a description
 * - edit_relationship: Update relationship description
 * - delete_relationship: Remove relationship link
 * - get_relationship: Retrieve single relationship
 * - get_relationships_attached_to_contact: List all relationships for a contact
 *
 * Relationships are bi-directional and appear on both contact records.
 * Common uses: spouse, referral source, business partner, etc.
 *
 * @module tools/relationships
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

export function registerRelationshipTools(server: McpServer): void {
  // create_relationship
  server.registerTool(
    'create_relationship',
    {
      title: 'Create Relationship',
      description: `Create a relationship between two contacts or companies.
Relationships are bi-directional and visible on both contact records.
Use the note field to describe the relationship type (e.g., "Spouse", "Referred by").`,
      inputSchema: {
        contact_id_1: z.string().describe('First contact or company ID'),
        contact_id_2: z.string().describe('Second contact or company ID'),
        note: z.string().describe('Description of the relationship')
      }
    },
    async ({ contact_id_1, contact_id_2, note }) => {
      try {
        const client = getClient();
        const result = await client.call<{ RelationshipId: string }>('CreateRelationship', {
          ContactId1: contact_id_1,
          ContactId2: contact_id_2,
          Note: note
        });
        return {
          content: [{ type: 'text' as const, text: `Relationship created successfully. RelationshipId: ${result.RelationshipId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_relationship
  server.registerTool(
    'edit_relationship',
    {
      title: 'Edit Relationship',
      description: `Update the note on an existing relationship.
The note describes the nature of the relationship between contacts.`,
      inputSchema: {
        relationship_id: z.string().describe('The RelationshipId to edit'),
        note: z.string().describe('Updated relationship description')
      }
    },
    async ({ relationship_id, note }) => {
      try {
        const client = getClient();
        await client.call('EditRelationship', { RelationshipId: relationship_id, Note: note });
        return {
          content: [{ type: 'text' as const, text: `Relationship ${relationship_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_relationship
  server.registerTool(
    'delete_relationship',
    {
      title: 'Delete Relationship',
      description: `Delete a relationship between two contacts.
WARNING: This permanently removes the relationship from both contact records.`,
      inputSchema: {
        relationship_id: z.string().describe('The RelationshipId to delete')
      }
    },
    async ({ relationship_id }) => {
      try {
        const client = getClient();
        await client.call('DeleteRelationship', { RelationshipId: relationship_id });
        return {
          content: [{ type: 'text' as const, text: `Relationship ${relationship_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_relationship
  server.registerTool(
    'get_relationship',
    {
      title: 'Get Relationship',
      description: `Retrieve details about a specific relationship.
Returns both contact IDs, the note, and metadata about both contacts.`,
      inputSchema: {
        relationship_id: z.string().describe('The RelationshipId to retrieve')
      }
    },
    async ({ relationship_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetRelationship', { RelationshipId: relationship_id });
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

  // get_relationships_attached_to_contact
  server.registerTool(
    'get_relationships_attached_to_contact',
    {
      title: 'Get Relationships For Contact',
      description: `Retrieve all relationships for a specific contact.
Returns all contacts linked to this contact with their relationship notes.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId to get relationships for'),
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

        const result = await client.call('GetRelationshipsAttachedToContact', params);
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
