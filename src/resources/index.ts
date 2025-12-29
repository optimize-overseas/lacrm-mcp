/**
 * MCP Resources for LACRM MCP Server
 *
 * Provides discoverable workflow documentation that helps AI clients
 * understand how to use the MCP effectively.
 *
 * Resources:
 * - lacrm://workflows/overview - Main guide for all operations
 * - lacrm://workflows/contacts - Contact/company workflow
 * - lacrm://workflows/pipeline-items - Pipeline item workflow
 *
 * @module resources
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Workflow overview content - the main guide
 */
const OVERVIEW_CONTENT = `# LACRM MCP Workflow Guide

## Before ANY Create/Edit Operation

ALWAYS call the appropriate schema tool FIRST to understand required fields and their formats.

| Operation | Call First | Why |
|-----------|------------|-----|
| Create/edit CONTACT | get_contact_schema | See all fields (fixed + custom), required status, formats |
| Create/edit COMPANY | get_company_schema | See all fields (fixed + custom), required status, formats |
| Create/edit PIPELINE ITEM | get_pipeline_item_schema(pipeline_id) | See required custom fields and valid dropdown options |
| Assign to user | get_users | Get valid user IDs |
| Add to group | get_groups | Get valid group IDs |
| Create event | get_calendars | Get valid calendar IDs |

## What Schema Tools Return

Each schema tool returns field information including:

- **name**: The parameter name to use in create/edit calls
- **required**: true/false - MUST be provided if true
- **type**: Field type (Text, Dropdown, Date, Array, etc.)
- **input_format**: Exact format expected (e.g., "YYYY-MM-DD" for dates)
- **valid_options**: For Dropdown/RadioList fields, the exact allowed values
- **is_custom_field**: true for account-specific fields, false for built-in fields

## Quick Reference: Required Fields

### Contact (minimum required):
- name: Full name as string
- assigned_to: User ID from get_users

### Company (minimum required):
- name: Company name (must be unique)
- assigned_to: User ID from get_users
- is_company: true

### Pipeline Item (minimum required):
- contact_id: Contact to attach to
- pipeline_id: Pipeline ID from get_pipelines
- status_id: Status ID from get_pipelines
- custom_fields: Check get_pipeline_item_schema for required fields

## Error Recovery

If you receive an error about a missing required field, call the appropriate schema tool to see what fields are needed.

Example error: "'Hunter' field is required for CreatePipelineItem"
Solution: Call get_pipeline_item_schema(pipeline_id) to see the Hunter field's valid options.
`;

/**
 * Contact workflow content
 */
const CONTACTS_CONTENT = `# Contact & Company Workflow

## Creating a Contact

### Step 1: Get the Schema
\`\`\`
Call: get_contact_schema
\`\`\`

This returns ALL fields including:
- Fixed fields: name, email, phone, address, company_name, job_title, etc.
- Custom fields: Account-specific fields configured by the user

### Step 2: Get User IDs (for assigned_to)
\`\`\`
Call: get_users
\`\`\`

Returns all users with their IDs. Use one for the required assigned_to field.

### Step 3: Create the Contact
\`\`\`
Call: create_contact
Parameters:
{
  "name": "John Smith",
  "assigned_to": "<user_id from step 2>",
  "email": [{"text": "john@example.com", "type": "Work"}],
  "phone": [{"text": "555-123-4567", "type": "Mobile"}],
  "company_name": "Acme Corp"
}
\`\`\`

## Creating a Company

Same workflow, but add is_company: true:
\`\`\`
{
  "name": "Acme Corporation",
  "is_company": true,
  "assigned_to": "<user_id>"
}
\`\`\`

Note: Company names must be unique in the account.

## Editing a Contact

### Step 1: Find the Contact
\`\`\`
Call: search_contacts with search terms
OR
Call: get_contact if you have the ID
\`\`\`

### Step 2: Check Available Fields
\`\`\`
Call: get_contact_schema
\`\`\`

### Step 3: Edit the Contact
\`\`\`
Call: edit_contact
Parameters:
{
  "contact_id": "<contact_id>",
  "job_title": "New Title",
  "email": [{"text": "newemail@example.com", "type": "Work"}]
}
\`\`\`

## Field Format Reference

| Field | Format |
|-------|--------|
| email | Array of {text, type: "Work"/"Personal"/"Other"} |
| phone | Array of {text, type: "Work"/"Mobile"/"Home"/"Fax"/"Other"} |
| address | Array of {street, city, state, zip, country, type} |
| website | Array of {text, type} |
| birthday | "YYYY-MM-DD" or "0000-MM-DD" for annual dates |
`;

/**
 * Pipeline item workflow content
 */
const PIPELINE_ITEMS_CONTENT = `# Pipeline Item Workflow

Pipeline items represent deals, opportunities, or other tracked items attached to contacts.

## Creating a Pipeline Item

### Step 1: Get Pipeline Information
\`\`\`
Call: get_pipelines
\`\`\`

This returns all pipelines with their:
- PipelineId: Use this when creating items
- Statuses: Array of {StatusId, Name} - use StatusId for initial status

### Step 2: Get Required Custom Fields
\`\`\`
Call: get_pipeline_item_schema
Parameters: { "pipeline_id": "<pipeline_id from step 1>" }
\`\`\`

IMPORTANT: Each pipeline can have different custom fields, and some may be REQUIRED.

The schema returns:
- required_fields: Fields you MUST provide
- optional_fields: Fields you can optionally provide
- For dropdown fields: valid_options with exact allowed values

### Step 3: Get Contact ID
\`\`\`
Call: search_contacts
\`\`\`

Find the contact to attach the pipeline item to.

### Step 4: Create the Pipeline Item
\`\`\`
Call: create_pipeline_item
Parameters:
{
  "contact_id": "<contact_id>",
  "pipeline_id": "<pipeline_id>",
  "status_id": "<status_id>",
  "custom_fields": {
    "Deal Value": 50000,
    "Hunter": "Matt"  // Must match a valid_option exactly
  }
}
\`\`\`

## Common Errors and Solutions

### Error: "'FieldName' field is required"
- Call get_pipeline_item_schema to see the required field
- Add the field to custom_fields with a valid value

### Error: Invalid dropdown value
- Call get_pipeline_item_schema to see valid_options for that field
- Use exactly one of the listed options (case-sensitive)

## Editing a Pipeline Item

### Step 1: Get Current Item (optional)
\`\`\`
Call: get_pipeline_item
Parameters: { "pipeline_item_id": "<id>" }
\`\`\`

### Step 2: Check Available Fields
\`\`\`
Call: get_pipeline_item_schema
Parameters: { "pipeline_id": "<pipeline_id>" }
\`\`\`

### Step 3: Edit the Item
\`\`\`
Call: edit_pipeline_item
Parameters:
{
  "pipeline_item_id": "<id>",
  "status_id": "<new_status_id>",  // Optional: change status
  "custom_fields": {
    "Deal Value": 75000  // Update custom field
  }
}
\`\`\`

## Moving Items Between Statuses

To move a pipeline item to a different status:
\`\`\`
Call: edit_pipeline_item
Parameters:
{
  "pipeline_item_id": "<id>",
  "status_id": "<new_status_id>"
}
\`\`\`

Get valid status IDs from get_pipelines.
`;

/**
 * Register all workflow resources with the MCP server
 */
export function registerResources(server: McpServer): void {
  // Overview resource - main workflow guide
  server.registerResource(
    'workflow_overview',
    'lacrm://workflows/overview',
    {
      description: 'START HERE: Overview of LACRM MCP workflows - explains what tools to call before any operation',
      mimeType: 'text/markdown'
    },
    async (uri: URL) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: OVERVIEW_CONTENT
      }]
    })
  );

  // Contact workflow resource
  server.registerResource(
    'workflow_contacts',
    'lacrm://workflows/contacts',
    {
      description: 'Detailed workflow for creating and editing contacts and companies',
      mimeType: 'text/markdown'
    },
    async (uri: URL) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: CONTACTS_CONTENT
      }]
    })
  );

  // Pipeline items workflow resource
  server.registerResource(
    'workflow_pipeline_items',
    'lacrm://workflows/pipeline-items',
    {
      description: 'Detailed workflow for creating and editing pipeline items (deals/opportunities)',
      mimeType: 'text/markdown'
    },
    async (uri: URL) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/markdown',
        text: PIPELINE_ITEMS_CONTENT
      }]
    })
  );
}
