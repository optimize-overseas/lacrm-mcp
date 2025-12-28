/**
 * Settings Tools Registry for LACRM MCP Server
 *
 * Account configuration management organized by entity:
 * - Custom Fields: Create, edit, delete, get field definitions
 * - Groups: Create, edit, delete, get group definitions
 * - Pipelines: Create, edit, delete, get pipeline configurations
 * - Pipeline Statuses: Create, edit, delete, get status definitions
 * - Teams: Create, edit, delete, get team configurations
 * - Webhooks: Create, delete, get webhook configurations
 *
 * These tools modify account-level settings. Use with caution
 * as changes affect all users in the account.
 *
 * @module tools/settings
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCustomFieldSettingsTools } from './custom-fields.js';
import { registerGroupSettingsTools } from './groups.js';
import { registerPipelineSettingsTools } from './pipelines.js';
import { registerPipelineStatusSettingsTools } from './pipeline-statuses.js';
import { registerTeamSettingsTools } from './teams.js';
import { registerWebhookSettingsTools } from './webhooks.js';

export function registerSettingsTools(server: McpServer): void {
  registerCustomFieldSettingsTools(server);
  registerGroupSettingsTools(server);
  registerPipelineSettingsTools(server);
  registerPipelineStatusSettingsTools(server);
  registerTeamSettingsTools(server);
  registerWebhookSettingsTools(server);
}
