/**
 * Event Tools for LACRM MCP Server
 *
 * Calendar event management:
 * - create_event: Schedule meetings, calls, appointments
 * - edit_event: Update event details
 * - delete_event: Remove events
 * - get_event: Retrieve single event
 * - search_events: Find events by date range and filters
 * - get_events_attached_to_contact: List all events for a contact
 *
 * Events support recurring schedules via RFC 5545 recurrence rules
 * and can be attached to contacts and assigned to user calendars.
 *
 * @module tools/events
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';
import { summarizeResults } from '../../utils/summarize.js';
import { resolveUserNames, resolveCalendarNames } from '../../utils/resolve-names.js';
import { countAll } from '../../utils/count-all.js';

const attendeeSchema = z.object({
  IsUser: z.boolean().describe('True if attendee is a CRM user, false for contacts'),
  AttendeeId: z.string().describe('User ID or Contact ID'),
  AttendanceStatus: z.enum(['IsAttending', 'Maybe', 'NotAttending']).optional()
});

export function registerEventTools(server: McpServer): void {
  // create_event
  server.registerTool(
    'create_event',
    {
      title: 'Create Event',
      description: `Create a calendar event in Less Annoying CRM.
Use this tool to schedule meetings, calls, or other time-specific activities.
Events can be attached to contacts and assigned to specific calendars.

Required: name, start_date, end_date.
Use get_calendars to find valid calendar IDs.
Use get_users to find valid user IDs for attendees.

Supports recurring events with RFC 5545 recurrence rules (e.g., "FREQ=WEEKLY;BYDAY=MO,WE,FR").`,
      inputSchema: {
        name: z.string().describe('Event name/title'),
        start_date: z.string().describe('Start date/time in ISO 8601 format with timezone'),
        end_date: z.string().describe('End date/time in ISO 8601 format'),
        is_all_day: z.boolean().optional().describe('True for all-day events (time ignored)'),
        location: z.string().optional().describe('Event location'),
        description: z.string().optional().describe('Event details'),
        calendar_id: z.string().optional().describe('Calendar ID (defaults to primary)'),
        attendees: z.array(attendeeSchema).optional().describe('Event attendees (users or contacts)'),
        is_recurring: z.boolean().optional().describe('True for recurring events'),
        recurrence_rule: z.string().optional().describe('RFC 5545 recurrence rule'),
        end_recurrence_date: z.string().optional().describe('Final recurrence date')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          Name: args.name,
          StartDate: args.start_date,
          EndDate: args.end_date
        };

        if (args.is_all_day !== undefined) params.IsAllDay = args.is_all_day;
        if (args.location) params.Location = args.location;
        if (args.description) params.Description = args.description;
        if (args.calendar_id) params.CalendarId = args.calendar_id;
        if (args.attendees) params.Attendees = args.attendees;
        if (args.is_recurring !== undefined) params.IsRecurring = args.is_recurring;
        if (args.recurrence_rule) params.RecurrenceRule = args.recurrence_rule;
        if (args.end_recurrence_date) params.EndRecurrenceRule = args.end_recurrence_date;

        const result = await client.call<{ EventId: string }>('CreateEvent', params);
        return {
          content: [{ type: 'text' as const, text: `Event created successfully. EventId: ${result.EventId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // edit_event
  server.registerTool(
    'edit_event',
    {
      title: 'Edit Event',
      description: `Update an existing calendar event in Less Annoying CRM.
Only include fields you want to change - other fields remain unchanged.

Required: event_id.
Use search_events or get_event to find valid event IDs.`,
      inputSchema: {
        event_id: z.string().describe('The EventId to edit'),
        name: z.string().optional().describe('Event name'),
        start_date: z.string().optional().describe('New start date/time'),
        end_date: z.string().optional().describe('New end date/time'),
        is_all_day: z.boolean().optional(),
        location: z.string().optional(),
        description: z.string().optional(),
        calendar_id: z.string().optional(),
        attendees: z.array(attendeeSchema).optional(),
        is_recurring: z.boolean().optional(),
        recurrence_rule: z.string().optional(),
        end_recurrence_date: z.string().optional()
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          EventId: args.event_id
        };

        if (args.name !== undefined) params.Name = args.name;
        if (args.start_date !== undefined) params.StartDate = args.start_date;
        if (args.end_date !== undefined) params.EndDate = args.end_date;
        if (args.is_all_day !== undefined) params.IsAllDay = args.is_all_day;
        if (args.location !== undefined) params.Location = args.location;
        if (args.description !== undefined) params.Description = args.description;
        if (args.calendar_id !== undefined) params.CalendarId = args.calendar_id;
        if (args.attendees !== undefined) params.Attendees = args.attendees;
        if (args.is_recurring !== undefined) params.IsRecurring = args.is_recurring;
        if (args.recurrence_rule !== undefined) params.RecurrenceRule = args.recurrence_rule;
        if (args.end_recurrence_date !== undefined) params.EndRecurrenceRule = args.end_recurrence_date;

        await client.call('EditEvent', params);
        return {
          content: [{ type: 'text' as const, text: `Event ${args.event_id} updated successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // delete_event
  server.registerTool(
    'delete_event',
    {
      title: 'Delete Event',
      description: `Delete a calendar event from Less Annoying CRM.
WARNING: This permanently removes the event from all attendee calendars.

Required: event_id.`,
      inputSchema: {
        event_id: z.string().describe('The EventId to delete')
      }
    },
    async ({ event_id }) => {
      try {
        const client = getClient();
        await client.call('DeleteEvent', { EventId: event_id });
        return {
          content: [{ type: 'text' as const, text: `Event ${event_id} deleted successfully.` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_event
  server.registerTool(
    'get_event',
    {
      title: 'Get Event',
      description: `Retrieve a single calendar event by ID.
Use this when you already have an EventId and need the record.

NOTE: search_events returns the same full data for each match. Only use get_event when you have an ID but not the data.`,
      inputSchema: {
        event_id: z.string().describe('The EventId to retrieve')
      }
    },
    async ({ event_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetEvent', { EventId: event_id });
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

  // search_events
  server.registerTool(
    'search_events',
    {
      title: 'Search Events',
      description: `Search for calendar events within a date range.
Use this tool to find events by date, user, calendar, or contact.

RETURNS FULL DATA: Each result includes all event fields (name, dates, location, attendees, recurrence, etc.) - no need to call get_event afterward.

Supports filtering by:
- Date range (start_date and end_date)
- Specific users (by ID or name)
- Specific calendars (by ID or name)
- Specific contact

Use count_only=true for accurate counts on large datasets without returning the full result set.`,
      inputSchema: {
        start_date: z.string().optional().describe('Start of date range (ISO 8601)'),
        end_date: z.string().optional().describe('End of date range (ISO 8601)'),
        user_filter: z.array(z.string()).optional().describe('Filter by user IDs. Mutually exclusive with user_name_filter.'),
        user_name_filter: z.array(z.string()).optional().describe('Filter by user names (case-insensitive, auto-resolved to IDs). Mutually exclusive with user_filter.'),
        calendar_filter: z.array(z.string()).optional().describe('Filter by calendar IDs. Mutually exclusive with calendar_name_filter.'),
        calendar_name_filter: z.array(z.string()).optional().describe('Filter by calendar names (case-insensitive, auto-resolved to IDs). Mutually exclusive with calendar_filter.'),
        contact_id: z.string().optional().describe('Filter by contact ID (overrides other filters)'),
        sort_direction: z.enum(['Ascending', 'Descending']).optional(),
        max_results: z.number().optional().describe('Max results (default 500, max 10000)'),
        page: z.number().optional().describe('Page number for pagination'),
        count_only: z.boolean().optional().describe('When true, auto-paginates and returns only total count and breakdowns (no results array). Use for accurate counts on large datasets.')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        // Validation: mutually exclusive filters
        if (args.user_filter && args.user_name_filter) {
          throw new Error('Use user_filter or user_name_filter, not both');
        }
        if (args.calendar_filter && args.calendar_name_filter) {
          throw new Error('Use calendar_filter or calendar_name_filter, not both');
        }

        // Resolve name-based filters to IDs
        let userFilter = args.user_filter;
        if (args.user_name_filter) {
          userFilter = await resolveUserNames(client, args.user_name_filter);
        }
        let calendarFilter = args.calendar_filter;
        if (args.calendar_name_filter) {
          calendarFilter = await resolveCalendarNames(client, args.calendar_name_filter);
        }

        const params: Record<string, unknown> = {};

        if (args.start_date) params.StartDate = args.start_date;
        if (args.end_date) params.EndDate = args.end_date;
        if (userFilter) params.UserFilter = userFilter;
        if (calendarFilter) params.CalendarFilter = calendarFilter;
        if (args.contact_id) params.ContactId = args.contact_id;
        if (args.sort_direction) params.SortDirection = args.sort_direction;
        if (args.max_results) params.MaxNumberOfResults = args.max_results;
        if (args.page) params.Page = args.page;

        // count_only mode: auto-paginate and return just summary
        if (args.count_only) {
          const countResult = await countAll(client, 'GetEvents', params, []);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(countResult, null, 2) }]
          };
        }

        const result = await client.call<{ Results?: unknown[]; HasMoreResults?: boolean }>('GetEvents', params);
        const items = Array.isArray(result) ? result : (result.Results || []);
        const hasMore = !Array.isArray(result) && result.HasMoreResults === true;
        return {
          content: [{ type: 'text' as const, text: summarizeResults(items, hasMore, []) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_events_attached_to_contact
  server.registerTool(
    'get_events_attached_to_contact',
    {
      title: 'Get Events For Contact',
      description: `Retrieve all calendar events for a specific contact.
RETURNS FULL DATA: Each result includes all event fields - no need to call get_event afterward.
Use count_only=true for accurate counts without returning the full result set.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId to get events for'),
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
          const countResult = await countAll(client, 'GetEventsAttachedToContact', params, []);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(countResult, null, 2) }]
          };
        }

        const result = await client.call<{ Results?: unknown[]; HasMoreResults?: boolean }>('GetEventsAttachedToContact', params);
        const items = Array.isArray(result) ? result : (result.Results || []);
        const hasMore = !Array.isArray(result) && result.HasMoreResults === true;
        return {
          content: [{ type: 'text' as const, text: summarizeResults(items, hasMore, []) }]
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
