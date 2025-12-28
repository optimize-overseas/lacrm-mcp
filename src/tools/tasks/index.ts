/**
 * Task Tools for LACRM MCP Server
 *
 * Task management for follow-ups and reminders:
 * - create_task: Create new tasks with due dates
 * - edit_task: Update or mark tasks complete
 * - delete_task: Remove tasks permanently
 * - get_task: Retrieve single task
 * - search_tasks: Find tasks by date range and status
 * - get_tasks_attached_to_contact: List all tasks for a contact
 *
 * Tasks are date-only reminders (no time component) that appear
 * in user task lists and daily agenda emails.
 *
 * @module tools/tasks
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

export function registerTaskTools(server: McpServer): void {
  // create_task
  server.registerTool(
    'create_task',
    {
      title: 'Create Task',
      description: `Create a new task in Less Annoying CRM.
Tasks are reminders that appear on user task lists and daily agenda emails.
Unlike events, tasks are date-only (no time component).

Required: name.
Optional: due_date, assigned_to, contact_id for linking to a contact.
Use get_users to find valid user IDs for assigned_to.
Use get_calendars to find valid calendar IDs.`,
      inputSchema: {
        name: z.string().describe('Task name/label'),
        due_date: z.string().optional().describe('Due date in YYYY-MM-DD format'),
        assigned_to: z.string().optional().describe('User ID to assign task to (defaults to caller)'),
        calendar_id: z.string().optional().describe('Calendar ID for categorization'),
        description: z.string().optional().describe('Task details (newlines preserved)'),
        contact_id: z.string().optional().describe('Contact ID to attach task to')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          Name: args.name
        };

        if (args.due_date) params.DueDate = args.due_date;
        if (args.assigned_to) params.AssignedTo = args.assigned_to;
        if (args.calendar_id) params.CalendarId = args.calendar_id;
        if (args.description) params.Description = args.description;
        if (args.contact_id) params.ContactId = args.contact_id;

        const result = await client.call<{ TaskId: string }>('CreateTask', params);
        return {
          content: [{ type: 'text' as const, text: `Task created successfully. TaskId: ${result.TaskId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_task
  server.registerTool(
    'edit_task',
    {
      title: 'Edit Task',
      description: `Update an existing task in Less Annoying CRM.
Use this tool to modify task details or mark tasks as complete.
Only include fields you want to change.

Required: task_id.
Use is_complete=true to mark a task as done (preferred over deleting).
Pass contact_id=null to detach from a contact.`,
      inputSchema: {
        task_id: z.string().describe('The TaskId to edit'),
        name: z.string().optional().describe('Updated task name'),
        due_date: z.string().optional().describe('New due date (YYYY-MM-DD)'),
        assigned_to: z.string().optional().describe('Reassign to user ID'),
        calendar_id: z.string().optional().describe('Change calendar'),
        description: z.string().optional().describe('Updated details'),
        contact_id: z.string().nullable().optional().describe('Contact ID (null to detach)'),
        is_complete: z.boolean().optional().describe('True to mark complete, false to reopen')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          TaskId: args.task_id
        };

        if (args.name !== undefined) params.Name = args.name;
        if (args.due_date !== undefined) params.DueDate = args.due_date;
        if (args.assigned_to !== undefined) params.AssignedTo = args.assigned_to;
        if (args.calendar_id !== undefined) params.CalendarId = args.calendar_id;
        if (args.description !== undefined) params.Description = args.description;
        if (args.contact_id !== undefined) params.ContactId = args.contact_id;
        if (args.is_complete !== undefined) params.IsComplete = args.is_complete;

        await client.call('EditTask', params);
        return {
          content: [{ type: 'text' as const, text: `Task ${args.task_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_task
  server.registerTool(
    'delete_task',
    {
      title: 'Delete Task',
      description: `Permanently delete a task from Less Annoying CRM.
WARNING: Consider using edit_task with is_complete=true instead to preserve history.

Required: task_id.`,
      inputSchema: {
        task_id: z.string().describe('The TaskId to delete')
      }
    },
    async ({ task_id }) => {
      try {
        const client = getClient();
        await client.call('DeleteTask', { TaskId: task_id });
        return {
          content: [{ type: 'text' as const, text: `Task ${task_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_task
  server.registerTool(
    'get_task',
    {
      title: 'Get Task',
      description: `Retrieve a single task by ID.
Returns complete task details including completion status and linked contact info.`,
      inputSchema: {
        task_id: z.string().describe('The TaskId to retrieve')
      }
    },
    async ({ task_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetTask', { TaskId: task_id });
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

  // search_tasks
  server.registerTool(
    'search_tasks',
    {
      title: 'Search Tasks',
      description: `Search for tasks within a date range.
Use this tool to find tasks by date, user, contact, or completion status.

Required: start_date, end_date.
Supports filtering by completion status (Both, Incomplete, Complete).`,
      inputSchema: {
        start_date: z.string().describe('Start of date range (YYYY-MM-DD)'),
        end_date: z.string().describe('End of date range (YYYY-MM-DD)'),
        user_filter: z.array(z.string()).optional().describe('Filter by user IDs'),
        contact_id: z.string().optional().describe('Filter by contact ID'),
        completion_status: z.enum(['Both', 'Incomplete', 'Complete']).optional().describe('Filter by completion (default: Both)'),
        sort_direction: z.enum(['Ascending', 'Descending']).optional(),
        max_results: z.number().optional().describe('Max results (default 500, max 10000)'),
        page: z.number().optional().describe('Page number for pagination')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          StartDate: args.start_date,
          EndDate: args.end_date
        };

        if (args.user_filter) params.UserFilter = args.user_filter;
        if (args.contact_id) params.ContactId = args.contact_id;
        if (args.completion_status) params.CompletionStatus = args.completion_status;
        if (args.sort_direction) params.SortDirection = args.sort_direction;
        if (args.max_results) params.MaxNumberOfResults = args.max_results;
        if (args.page) params.Page = args.page;

        const result = await client.call('GetTasks', params);
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

  // get_tasks_attached_to_contact
  server.registerTool(
    'get_tasks_attached_to_contact',
    {
      title: 'Get Tasks For Contact',
      description: `Retrieve all tasks for a specific contact.
Use this tool to see all tasks associated with a contact.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId to get tasks for'),
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

        const result = await client.call('GetTasksAttachedToContact', params);
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
