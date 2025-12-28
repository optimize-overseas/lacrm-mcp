/**
 * Email Tools for LACRM MCP Server
 *
 * Email logging and retrieval:
 * - create_email: Log email correspondence to contacts
 * - delete_email: Remove logged emails
 * - get_email: Retrieve single email
 * - search_emails: Find emails by date and filters
 * - get_emails_attached_to_contact: List all emails for a contact
 *
 * These tools log email records to contact history for tracking purposes.
 * Emails are not sent through LACRM - they're records of correspondence.
 *
 * @module tools/emails
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

const emailAddressSchema = z.object({
  Address: z.string().describe('Email address'),
  Name: z.string().optional().describe('Display name')
});

export function registerEmailTools(server: McpServer): void {
  // create_email
  server.registerTool(
    'create_email',
    {
      title: 'Create Email',
      description: `Log an email in Less Annoying CRM.
Use this to record email correspondence with contacts for tracking purposes.

Required: contact_ids, from, to, body, date.
The email is attached to the specified contacts' history.`,
      inputSchema: {
        contact_ids: z.array(z.string()).describe('Contact IDs to attach the email to'),
        user_is_sender: z.boolean().optional().describe('True if email was sent by the CRM user (default: false)'),
        from: emailAddressSchema.describe('Sender email address and name'),
        to: z.array(emailAddressSchema).describe('Recipient email addresses'),
        cc: z.array(emailAddressSchema).optional().describe('CC recipients'),
        subject: z.string().optional().describe('Email subject line'),
        body: z.string().describe('Email content'),
        date: z.string().describe('Email timestamp (ISO 8601)')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {
          ContactIds: args.contact_ids,
          From: args.from,
          To: args.to,
          Body: args.body,
          Date: args.date
        };

        if (args.user_is_sender !== undefined) params.UserIsSender = args.user_is_sender;
        if (args.cc) params.Cc = args.cc;
        if (args.subject) params.Subject = args.subject;

        const result = await client.call<{ EmailId: string }>('CreateEmail', params);
        return {
          content: [{ type: 'text' as const, text: `Email logged successfully. EmailId: ${result.EmailId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_email
  server.registerTool(
    'get_email',
    {
      title: 'Get Email',
      description: `Retrieve a single logged email by ID.
Returns complete email details including sender, recipients, and body.`,
      inputSchema: {
        email_id: z.string().describe('The EmailId to retrieve')
      }
    },
    async ({ email_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetEmail', { EmailId: email_id });
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

  // search_emails
  server.registerTool(
    'search_emails',
    {
      title: 'Search Emails',
      description: `Search for logged emails with optional filters.
Use this to find emails by date range, user, or contact.`,
      inputSchema: {
        date_start: z.string().optional().describe('Return emails after this date (ISO 8601)'),
        date_end: z.string().optional().describe('Return emails before this date (ISO 8601)'),
        user_filter: z.array(z.string()).optional().describe('Filter by user IDs'),
        contact_id: z.string().optional().describe('Filter by contact ID'),
        include_company_contacts: z.boolean().optional().describe('Include emails from contacts at same company'),
        sort_direction: z.enum(['Ascending', 'Descending']).optional(),
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
        if (args.include_company_contacts !== undefined) params.GetContactsAtCompanyEmails = args.include_company_contacts;
        if (args.sort_direction) params.SortDirection = args.sort_direction;
        if (args.max_results) params.MaxNumberOfResults = args.max_results;
        if (args.page) params.Page = args.page;

        const result = await client.call('GetEmails', params);
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

  // get_emails_attached_to_contact
  server.registerTool(
    'get_emails_attached_to_contact',
    {
      title: 'Get Emails For Contact',
      description: `Retrieve all logged emails for a specific contact.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId to get emails for'),
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

        const result = await client.call('GetEmailsAttachedToContact', params);
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

  // delete_email
  server.registerTool(
    'delete_email',
    {
      title: 'Delete Email',
      description: `Delete a logged email from a contact's profile.
WARNING: This permanently removes the email record.`,
      inputSchema: {
        email_id: z.string().describe('The EmailId to delete')
      }
    },
    async ({ email_id }) => {
      try {
        const client = getClient();
        await client.call('DeleteEmail', { EmailId: email_id });
        return {
          content: [{ type: 'text' as const, text: `Email ${email_id} deleted successfully.` }]
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
