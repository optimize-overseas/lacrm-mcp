/**
 * Tool Registry for LACRM MCP Server
 *
 * Central registration point for all 75 MCP tools organized by domain:
 *
 * Discovery Tools (5):
 *   - get_custom_fields, get_pipelines, get_groups, get_users, get_calendars
 *
 * Contact Tools (6):
 *   - create_contact, edit_contact, delete_contact
 *   - get_contact, get_contacts_by_ids, search_contacts
 *
 * Event Tools (6):
 *   - create_event, edit_event, delete_event
 *   - get_event, search_events, get_events_attached_to_contact
 *
 * Task Tools (6):
 *   - create_task, edit_task, delete_task
 *   - get_task, search_tasks, get_tasks_attached_to_contact
 *
 * Note Tools (6):
 *   - create_note, edit_note, delete_note
 *   - get_note, search_notes, get_notes_attached_to_contact
 *
 * Pipeline Item Tools (7):
 *   - create_pipeline_item, edit_pipeline_item
 *   - delete_pipeline_item, delete_pipeline_items_bulk
 *   - get_pipeline_item, search_pipeline_items, get_pipeline_items_attached_to_contact
 *
 * Email Tools (5):
 *   - create_email, delete_email
 *   - get_email, search_emails, get_emails_attached_to_contact
 *
 * File Tools (3):
 *   - create_file, get_file, get_files_attached_to_contact
 *
 * Relationship Tools (5):
 *   - create_relationship, edit_relationship, delete_relationship
 *   - get_relationship, get_relationships_attached_to_contact
 *
 * Group Membership Tools (4):
 *   - add_contact_to_group, remove_contact_from_group
 *   - get_groups_for_contact, get_contacts_in_group
 *
 * Settings Tools (25):
 *   - Custom Fields: create, edit, delete, get (4)
 *   - Groups: create, edit, delete, get (4)
 *   - Pipelines: create, edit, delete, get (4)
 *   - Pipeline Statuses: create, edit, delete, get (4)
 *   - Teams: create, edit, delete, get, get_all (5)
 *   - Webhooks: create, delete, get, get_all (4)
 *
 * @module tools
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDiscoveryTools } from './discovery/index.js';
import { registerContactTools } from './contacts/index.js';
import { registerEventTools } from './events/index.js';
import { registerTaskTools } from './tasks/index.js';
import { registerNoteTools } from './notes/index.js';
import { registerPipelineItemTools } from './pipeline-items/index.js';
import { registerEmailTools } from './emails/index.js';
import { registerFileTools } from './files/index.js';
import { registerRelationshipTools } from './relationships/index.js';
import { registerGroupMembershipTools } from './groups/index.js';
import { registerSettingsTools } from './settings/index.js';

/**
 * Register all LACRM tools with the MCP server.
 *
 * Tools are registered in logical groups following the recommended
 * workflow for interacting with LACRM:
 *
 * 1. Discovery - Learn about account structure (fields, pipelines, users)
 * 2. Contacts - Core contact and company management
 * 3. Activities - Events, tasks, and notes attached to contacts
 * 4. Pipeline Items - Sales/workflow tracking
 * 5. Additional - Emails, files, relationships, groups
 * 6. Settings - Account configuration management
 *
 * @param server - The MCP server instance to register tools with
 */
export function registerAllTools(server: McpServer): void {
  // Discovery tools - essential for learning account structure
  registerDiscoveryTools(server);

  // Contact tools - core CRM functionality
  registerContactTools(server);

  // Activity tools - track interactions with contacts
  registerEventTools(server);
  registerTaskTools(server);
  registerNoteTools(server);

  // Pipeline item tools - sales/workflow tracking
  registerPipelineItemTools(server);

  // Additional entity tools - supplementary contact data
  registerEmailTools(server);
  registerFileTools(server);
  registerRelationshipTools(server);
  registerGroupMembershipTools(server);

  // Settings tools - account configuration
  registerSettingsTools(server);
}
