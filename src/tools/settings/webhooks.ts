/**
 * Webhook Settings Tools for LACRM MCP Server
 *
 * Manage webhook configurations:
 * - create_webhook: Create new webhook subscription
 * - delete_webhook: Remove webhook
 * - get_webhook: Retrieve single webhook details
 * - get_webhooks: List all webhooks (optionally including archived)
 *
 * Requirements:
 * - Endpoint URL must be HTTPS
 * - Endpoint must respond to handshake request
 *
 * Scopes: User (personal events only), Account (all user events)
 *
 * @module tools/settings/webhooks
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

const webhookScopeEnum = z.enum(['User', 'Account']);

export function registerWebhookSettingsTools(server: McpServer): void {
  // create_webhook
  server.registerTool(
    'create_webhook',
    {
      title: 'Create Webhook',
      description: `Create a new webhook in Less Annoying CRM.
Webhooks send POST requests to your URL when events occur.

Requirements:
- endpoint_url must be HTTPS
- Your endpoint must respond to an initial handshake request

Scope:
- User: Only triggers for actions by the authenticated user
- Account: Triggers for actions by any user in the account

Common events: Contact.Create, Contact.Edit, Contact.Delete, PipelineItemStatus.Create, PipelineItemStatus.Edit`,
      inputSchema: {
        endpoint_url: z.string().describe('HTTPS URL to receive webhook POSTs'),
        events: z.array(z.string()).describe('Event types to subscribe to'),
        webhook_scope: webhookScopeEnum.describe('User or Account scope')
      }
    },
    async (args) => {
      try {
        // Validate HTTPS requirement
        if (!args.endpoint_url.toLowerCase().startsWith('https://')) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Webhook endpoint URL must use HTTPS' }],
            isError: true
          };
        }

        const client = getClient();

        const params: Record<string, unknown> = {
          EndpointUrl: args.endpoint_url,
          Events: args.events,
          WebhookScope: args.webhook_scope
        };

        const result = await client.call<{ WebhookId: string }>('CreateWebhook', params);
        return {
          content: [{ type: 'text' as const, text: `Webhook created successfully. WebhookId: ${result.WebhookId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_webhook
  server.registerTool(
    'get_webhook',
    {
      title: 'Get Webhook',
      description: `Get detailed information about a single webhook.
Returns endpoint URL, last send date, subscribed events, and archive status.`,
      inputSchema: {
        webhook_id: z.string().describe('The WebhookId to retrieve')
      }
    },
    async ({ webhook_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetWebhook', { WebhookId: webhook_id });
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

  // get_webhooks
  server.registerTool(
    'get_webhooks',
    {
      title: 'Get Webhooks',
      description: `Get all webhooks on the account.
Optionally include archived webhooks.`,
      inputSchema: {
        include_archived: z.boolean().optional().describe('Include archived webhooks (default: false)')
      }
    },
    async ({ include_archived }) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = {};
        if (include_archived !== undefined) params.IncludeArchived = include_archived;

        const result = await client.call('GetWebhooks', params);
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

  // delete_webhook
  server.registerTool(
    'delete_webhook',
    {
      title: 'Delete Webhook',
      description: `Delete a webhook from the account.
The webhook will stop sending events immediately.`,
      inputSchema: {
        webhook_id: z.string().describe('The WebhookId to delete')
      }
    },
    async ({ webhook_id }) => {
      try {
        const client = getClient();
        await client.call('DeleteWebhook', { WebhookId: webhook_id });
        return {
          content: [{ type: 'text' as const, text: `Webhook ${webhook_id} deleted successfully.` }]
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
