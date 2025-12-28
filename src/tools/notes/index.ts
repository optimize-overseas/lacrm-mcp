/**
 * Note Tools for LACRM MCP Server
 *
 * Contact note management:
 * - create_note: Add notes to contact history
 * - edit_note: Update existing notes
 * - delete_note: Remove notes permanently
 * - get_note: Retrieve single note
 * - search_notes: Find notes by date and user
 * - get_notes_attached_to_contact: List all notes for a contact
 *
 * Notes are timestamped text entries that appear in the contact's
 * activity history. They support plain text with preserved newlines.
 *
 * @module tools/notes
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

export function registerNoteTools(server: McpServer): void {
  // create_note
  server.registerTool(
    'create_note',
    {
      title: 'Create Note',
      description: `Create a new note attached to a contact in Less Annoying CRM.
Notes are timestamped text entries that appear in contact history.

Required: contact_id, note.
The note text preserves newlines but escapes HTML/markdown.`,
      inputSchema: {
        contact_id: z.string().describe('Contact or company ID to attach the note to'),
        note: z.string().describe('Note content (plain text, newlines preserved)'),
        date_displayed: z.string().optional().describe('Timestamp for display in history (ISO 8601, defaults to now)')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          ContactId: args.contact_id,
          Note: args.note
        };

        if (args.date_displayed) params.DateDisplayedInHistory = args.date_displayed;

        const result = await client.call<{ NoteId: string }>('CreateNote', params);
        return {
          content: [{ type: 'text' as const, text: `Note created successfully. NoteId: ${result.NoteId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_note
  server.registerTool(
    'edit_note',
    {
      title: 'Edit Note',
      description: `Update an existing note in Less Annoying CRM.
Only include fields you want to change.

Required: note_id.
Note content is completely replaced when updated.`,
      inputSchema: {
        note_id: z.string().describe('The NoteId to edit'),
        note: z.string().optional().describe('New note content (replaces existing)'),
        date_displayed: z.string().optional().describe('New timestamp for history display')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          NoteId: args.note_id
        };

        if (args.note !== undefined) params.Note = args.note;
        if (args.date_displayed !== undefined) params.DateDisplayedInHistory = args.date_displayed;

        await client.call('EditNote', params);
        return {
          content: [{ type: 'text' as const, text: `Note ${args.note_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_note
  server.registerTool(
    'delete_note',
    {
      title: 'Delete Note',
      description: `Delete a note from a contact's profile in Less Annoying CRM.
WARNING: This permanently removes the note.

Required: note_id.`,
      inputSchema: {
        note_id: z.string().describe('The NoteId to delete')
      }
    },
    async ({ note_id }) => {
      try {
        const client = getClient();
        await client.call('DeleteNote', { NoteId: note_id });
        return {
          content: [{ type: 'text' as const, text: `Note ${note_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_note
  server.registerTool(
    'get_note',
    {
      title: 'Get Note',
      description: `Retrieve a single note by ID.
Returns complete note details including content, timestamps, and linked metadata.`,
      inputSchema: {
        note_id: z.string().describe('The NoteId to retrieve')
      }
    },
    async ({ note_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetNote', { NoteId: note_id });
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

  // search_notes
  server.registerTool(
    'search_notes',
    {
      title: 'Search Notes',
      description: `Search for notes with optional date and user filters.
Use this tool to find notes across all contacts or for specific users.

Supports filtering by date range, user, and specific contact.
Results sorted by note date.`,
      inputSchema: {
        date_start: z.string().optional().describe('Return notes on or after this date (ISO 8601)'),
        date_end: z.string().optional().describe('Return notes on or before this date (ISO 8601)'),
        user_filter: z.array(z.string()).optional().describe('Filter by user IDs who created notes'),
        contact_id: z.string().optional().describe('Filter by specific contact'),
        sort_direction: z.enum(['Ascending', 'Descending']).optional().describe('Sort order (default: Descending)'),
        max_results: z.number().optional().describe('Max results (default 500, max 10000)'),
        page: z.number().optional().describe('Page number for pagination')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {};

        if (args.date_start) params.DateFilterStart = args.date_start;
        if (args.date_end) params.DateFilterEnd = args.date_end;
        if (args.user_filter) params.UserFilter = args.user_filter;
        if (args.contact_id) params.ContactId = args.contact_id;
        if (args.sort_direction) params.SortDirection = args.sort_direction;
        if (args.max_results) params.MaxNumberOfResults = args.max_results;
        if (args.page) params.Page = args.page;

        const result = await client.call('GetNotes', params);
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

  // get_notes_attached_to_contact
  server.registerTool(
    'get_notes_attached_to_contact',
    {
      title: 'Get Notes For Contact',
      description: `Retrieve all notes for a specific contact.
Use this tool to see the complete note history for a contact.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId to get notes for'),
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

        const result = await client.call('GetNotesAttachedToContact', params);
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
