# LACRM MCP Server

A Model Context Protocol (MCP) server for Less Annoying CRM that provides comprehensive API access through 83 tools.

Published as [`@optimizeoverseas/lacrm-mcp`](https://www.npmjs.com/package/@optimizeoverseas/lacrm-mcp) on npm.

**Current version: 1.3.0**

## Key Features

- **83 tools** covering contacts, pipelines, tasks, events, notes, emails, files, relationships, groups, and settings
- **Name resolution**: Search tools accept human-readable names (status names, user names, calendar names, custom field names) and auto-resolve to IDs at runtime — no prerequisite lookup calls needed
- **count_only mode**: All search/list tools support `count_only: true` which auto-paginates through all results and returns accurate totals with categorical breakdowns — no manual pagination required
- **Flat-string shortcuts**: `email_address`, `phone_number`, `website_url` on contact create/edit auto-convert to the required array format
- **Response summaries**: List-returning tools wrap results in `{summary, results}` envelopes with machine-counted totals and breakdowns
- **ID sanitization**: Defense-in-depth stripping of accidental quote characters from ID parameters
- **Rate limiting**: Client-side enforcement of 120 requests/minute with automatic waiting

## Installation

### From npm (recommended for production)

```bash
npm install -g @optimizeoverseas/lacrm-mcp
```

### From source

```bash
git clone https://github.com/optimize-overseas/lacrm-mcp.git
cd lacrm-mcp
npm install
npm run build
```

## Configuration

### Environment Variable (Recommended)

Set the `LACRM_API_KEY` environment variable:

```bash
export LACRM_API_KEY=your-api-key
```

### Config File

Alternatively, create a config file at `~/.lacrm-config.json`:

```json
{
  "apiKey": "your-api-key"
}
```

## Claude Desktop Configuration

Add to your Claude Desktop configuration file (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "lacrm": {
      "command": "node",
      "args": ["/path/to/lacrm-mcp/build/index.js"],
      "env": {
        "LACRM_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Testing with MCP Inspector

```bash
npm run inspector
```

## MCP Resources

This server provides workflow resources that help AI clients understand how to use the MCP effectively. Resources are discoverable via the standard MCP `resources/list` protocol.

| Resource URI | Description |
|--------------|-------------|
| `lacrm://workflows/overview` | Start here - explains what tools to call before any operation |
| `lacrm://workflows/contacts` | Detailed workflow for creating and editing contacts/companies |
| `lacrm://workflows/pipeline-items` | Detailed workflow for creating and editing pipeline items |

**Usage**: Call `resources/list` to discover available resources, then `resources/read` with the URI to get the content.

## Response Format

### Summary Envelopes

All list-returning tools wrap their results in a structured `{summary, results}` envelope. The summary provides machine-counted totals and categorical breakdowns, which prevents LLMs from miscounting items in large JSON arrays -- a known failure mode when datasets exceed approximately 50 items.

**Envelope structure:**

```json
{
  "summary": {
    "total": 15,
    "has_more_results": false,
    "by_status": {
      "Active": 10,
      "Closed - Won": 3,
      "Closed - Lost": 2
    }
  },
  "results": [
    { "...full pipeline item data..." },
    { "...full pipeline item data..." }
  ]
}
```

The `summary` object always includes:
- `total` -- the exact count of items in the `results` array
- `has_more_results` -- whether the API has additional pages beyond this response

Depending on the tool, the summary may also include one or more categorical breakdowns that group items by a relevant field.

### Tools with Summary Envelopes

| Tool | Breakdowns | Description |
|------|------------|-------------|
| `search_contacts` | `by_assigned_to` | Counts by assigned user |
| `search_pipeline_items` | `by_status` | Counts by pipeline status name |
| `get_pipeline_items_attached_to_contact` | `by_pipeline`, `by_status` | Counts by pipeline name and status name |
| `search_tasks` | `by_completion` | Counts by completion (Yes/No) |
| `get_tasks_attached_to_contact` | `by_completion` | Counts by completion (Yes/No) |
| `search_emails` | `by_direction` | Counts by send direction (Yes/No for UserIsSender) |
| `get_emails_attached_to_contact` | `by_direction` | Counts by send direction (Yes/No for UserIsSender) |
| `search_events` | (total only) | Total count and pagination status |
| `get_events_attached_to_contact` | (total only) | Total count and pagination status |
| `search_notes` | (total only) | Total count and pagination status |
| `get_notes_attached_to_contact` | (total only) | Total count and pagination status |
| `get_files_attached_to_contact` | (total only) | Total count and pagination status |
| `get_contacts_in_group` | `by_assigned_to` | Counts by assigned user |

Single-record tools (e.g., `get_contact`, `get_task`, `get_pipeline_item`) return the raw API response directly without a summary envelope.

## Name Resolution (v1.3.0)

Many LACRM API parameters require internal IDs (status IDs, user IDs, calendar IDs, custom field IDs). In v1.3.0, name-based alternatives were added so the caller can pass human-readable names instead. The server resolves names to IDs at runtime by querying the LACRM API. All lookups are case-insensitive, and if a name cannot be resolved the error message lists all available options.

These parameters are **instance-agnostic** -- they work with any LACRM account regardless of how statuses, users, calendars, or custom fields are configured.

### Name Resolution Parameters

| Parameter | Available On | Replaces (mutually exclusive) |
|-----------|-------------|-------------------------------|
| `status_name_filter` | `search_pipeline_items` | `status_filter` |
| `status_name` | `create_pipeline_item`, `edit_pipeline_item` | `status_id` |
| `user_name_filter` | `search_pipeline_items`, `search_tasks`, `search_events` | `user_filter` |
| `calendar_name_filter` | `search_events` | `calendar_filter` |
| `custom_field_names` | `create_contact`, `edit_contact`, `create_pipeline_item`, `edit_pipeline_item` | `custom_fields` |

### How It Works

1. The caller passes a name-based parameter (e.g., `status_name: "Active"`)
2. The server queries the relevant API endpoint (e.g., `GetPipelineStatuses`)
3. A case-insensitive match resolves the name to its ID
4. The resolved ID is used for the actual API call
5. If no match is found, an error lists all available names

For `user_name_filter`, matching works against full name ("First Last"), first name only, or last name only.

For `custom_field_names`, dropdown fields are additionally validated -- if the supplied value is not among the allowed options, an error lists the valid choices.

### Example

Instead of:
```json
{
  "pipeline_id": "abc123",
  "status_id": "def456",
  "custom_fields": { "cf_789": "Matt" }
}
```

Use:
```json
{
  "pipeline_id": "abc123",
  "status_name": "Active",
  "custom_field_names": { "Hunter": "Matt" }
}
```

## Count Mode (v1.3.0)

All search and list tools support a `count_only` parameter. When set to `true`, the tool auto-paginates through all pages (up to a safety cap of 100 pages) and returns only aggregate counts with breakdowns -- no results array is included. This is useful for questions like "how many deals are in each status?" without transferring the full dataset.

### Supported Tools

| Tool | Breakdowns in Count Mode |
|------|--------------------------|
| `search_contacts` | `by_assigned_to` |
| `search_pipeline_items` | `by_status` |
| `get_pipeline_items_attached_to_contact` | `by_pipeline`, `by_status` |
| `search_tasks` | `by_completion` |
| `get_tasks_attached_to_contact` | `by_completion` |
| `search_events` | (total only) |
| `get_events_attached_to_contact` | (total only) |
| `search_notes` | (total only) |
| `get_notes_attached_to_contact` | (total only) |
| `search_emails` | `by_direction` |
| `get_emails_attached_to_contact` | `by_direction` |
| `get_contacts_in_group` | `by_assigned_to` |

### Count Mode Response

```json
{
  "total": 47,
  "breakdowns": {
    "by_status": {
      "Active": 30,
      "Closed - Won": 12,
      "Closed - Lost": 5
    }
  }
}
```

When `count_only` is `true`:
- The tool paginates through all available pages automatically
- No `results` array is returned -- only `total` and `breakdowns`
- A safety cap of 100 pages prevents runaway pagination

## Flat-String Shortcuts (v1.3.0)

`create_contact` and `edit_contact` accept simplified string parameters for common single-value fields:

| Shortcut Parameter | Expands To | Type |
|--------------------|-----------|------|
| `email_address` | `[{Text: "<value>", Type: "Work"}]` | Work email |
| `phone_number` | `[{Text: "<value>", Type: "Work"}]` | Work phone |
| `website_url` | `[{Text: "<value>"}]` | Website |

Each shortcut is mutually exclusive with its corresponding array parameter (e.g., `email_address` cannot be used together with `email`). This eliminates the need to construct array-of-objects structures for the common case of a single value.

### Example

Instead of:
```json
{
  "name": "Jane Doe",
  "email": [{"Text": "jane@example.com", "Type": "Work"}],
  "phone": [{"Text": "555-0100", "Type": "Work"}]
}
```

Use:
```json
{
  "name": "Jane Doe",
  "email_address": "jane@example.com",
  "phone_number": "555-0100"
}
```

## Available Tools

### Discovery Tools (10)

| Tool | Description |
|------|-------------|
| `get_workflow_guide` | **START HERE** - Get the workflow guide explaining what tools to call before any operation |
| `get_contact_schema` | Get complete field schema for contacts (fixed + custom fields) |
| `get_company_schema` | Get complete field schema for companies (fixed + custom fields) |
| `get_pipeline_item_schema` | Get complete field schema for pipeline items (fixed + custom fields) |
| `get_custom_fields` | Get custom field definitions with optional filtering by record type and pipeline |
| `get_pipeline_custom_fields` | Get custom fields for a specific pipeline with required/optional status |
| `get_pipelines` | Get all pipelines with their statuses |
| `get_groups` | Get all groups in the account |
| `get_users` | Get all users in the account |
| `get_calendars` | Get all calendars in the account |

### Contact Tools (6)

| Tool | Description |
|------|-------------|
| `create_contact` | Create a new contact or company |
| `edit_contact` | Update an existing contact |
| `delete_contact` | Delete a contact |
| `get_contact` | Get a contact by ID |
| `get_contacts_by_ids` | Get multiple contacts by IDs (up to 200) |
| `search_contacts` | Search contacts by name, email, phone, or custom fields |

### Event Tools (6)

| Tool | Description |
|------|-------------|
| `create_event` | Create a calendar event |
| `edit_event` | Update an existing event |
| `delete_event` | Delete an event |
| `get_event` | Get an event by ID |
| `search_events` | Search events with filters |
| `get_events_attached_to_contact` | Get all events for a contact |

### Task Tools (6)

| Tool | Description |
|------|-------------|
| `create_task` | Create a task |
| `edit_task` | Update an existing task |
| `delete_task` | Delete a task |
| `get_task` | Get a task by ID |
| `search_tasks` | Search tasks with filters |
| `get_tasks_attached_to_contact` | Get all tasks for a contact |

### Note Tools (6)

| Tool | Description |
|------|-------------|
| `create_note` | Create a note for a contact |
| `edit_note` | Update an existing note |
| `delete_note` | Delete a note |
| `get_note` | Get a note by ID |
| `search_notes` | Search notes with filters |
| `get_notes_attached_to_contact` | Get all notes for a contact |

### Pipeline Item Tools (7)

| Tool | Description |
|------|-------------|
| `create_pipeline_item` | Create a pipeline item (deal/opportunity) |
| `edit_pipeline_item` | Update a pipeline item |
| `delete_pipeline_item` | Delete a pipeline item |
| `delete_pipeline_items_bulk` | Delete multiple pipeline items |
| `get_pipeline_item` | Get a pipeline item by ID |
| `search_pipeline_items` | Search pipeline items with filters |
| `get_pipeline_items_attached_to_contact` | Get all pipeline items for a contact |

### Email Tools (5)

| Tool | Description |
|------|-------------|
| `create_email` | Log an email in the CRM |
| `get_email` | Get a logged email by ID |
| `search_emails` | Search logged emails with filters |
| `get_emails_attached_to_contact` | Get all emails for a contact |
| `delete_email` | Delete a logged email |

### File Tools (3)

| Tool | Description |
|------|-------------|
| `create_file` | Upload a file and attach to a contact |
| `get_file` | Get file info and download URL |
| `get_files_attached_to_contact` | Get all files for a contact |

### Relationship Tools (5)

| Tool | Description |
|------|-------------|
| `create_relationship` | Create a relationship between contacts |
| `edit_relationship` | Update a relationship |
| `delete_relationship` | Delete a relationship |
| `get_relationship` | Get a relationship by ID |
| `get_relationships_attached_to_contact` | Get all relationships for a contact |

### Group Membership Tools (4)

| Tool | Description |
|------|-------------|
| `add_contact_to_group` | Add a contact to a group |
| `remove_contact_from_group` | Remove a contact from a group |
| `get_groups_for_contact` | Get all groups a contact belongs to |
| `get_contacts_in_group` | Get all contacts in a group |

### Custom Field Settings Tools (4)

| Tool | Description |
|------|-------------|
| `create_custom_field` | Create a new custom field definition |
| `edit_custom_field` | Update an existing custom field |
| `delete_custom_field` | Delete a custom field |
| `get_custom_field` | Get details for a single custom field |

### Group Settings Tools (4)

| Tool | Description |
|------|-------------|
| `create_group` | Create a new group |
| `edit_group` | Update a group's properties |
| `delete_group` | Delete a group |
| `get_group` | Get details for a single group |

### Pipeline Settings Tools (4)

| Tool | Description |
|------|-------------|
| `create_pipeline` | Create a new pipeline |
| `edit_pipeline` | Update a pipeline's configuration |
| `delete_pipeline` | Delete a pipeline |
| `get_pipeline` | Get details for a single pipeline |

### Pipeline Status Settings Tools (4)

| Tool | Description |
|------|-------------|
| `create_pipeline_status` | Create a new status for a pipeline |
| `edit_pipeline_status` | Update a pipeline status |
| `delete_pipeline_status` | Delete a pipeline status |
| `get_pipeline_statuses` | Get all statuses for a pipeline |

### Team Settings Tools (5)

| Tool | Description |
|------|-------------|
| `create_team` | Create a new team |
| `edit_team` | Update a team's name or membership |
| `delete_team` | Delete a team |
| `get_team` | Get details for a single team |
| `get_teams` | Get all teams |

### Webhook Settings Tools (4)

| Tool | Description |
|------|-------------|
| `create_webhook` | Create a new webhook |
| `get_webhook` | Get details for a single webhook |
| `get_webhooks` | Get all webhooks |
| `delete_webhook` | Delete a webhook |

## Custom Fields

### Using `custom_field_names` (Recommended -- v1.3.0)

Pass field names directly as keys. The server resolves names to IDs automatically and validates dropdown values:

```json
{
  "custom_field_names": {
    "Lead Source": "Referral",
    "Deal Value": 50000,
    "Expected Close": "2025-03-15"
  }
}
```

Invalid field names return an error listing available fields. Invalid dropdown values return an error listing valid options.

### Using `custom_fields` (ID-based fallback)

1. Call `get_custom_fields` with `record_type="Contact"` or `record_type="Company"` (for contacts/companies) or `get_pipeline_custom_fields` with the `pipeline_id` (for pipeline items)
2. Note the field names, types, required status, and valid options
3. Use field names as keys in the `custom_fields` parameter

Example:
```json
{
  "custom_fields": {
    "Hunter": "Matt",
    "Deal Value": 50000,
    "Expected Close": "2025-03-15"
  }
}
```

## Pipeline Support

Workflow for creating pipeline items:

1. Call `get_pipelines` to discover pipeline IDs
2. Use `create_pipeline_item` with `pipeline_id` and either `status_name` (auto-resolves, v1.3.0) or `status_id`
3. Optionally include `custom_field_names` (v1.3.0) or `custom_fields` for pipeline custom fields

The tools provide clear error messages when required fields are missing or names don't match.

## API Reference

This MCP server wraps the [Less Annoying CRM API v2](https://www.lessannoyingcrm.com/developer/reference-v2). All API calls are made to `https://api.lessannoyingcrm.com/v2/`.

## Rate Limiting

The MCP server enforces rate limiting to protect LACRM's API:

- **Limit**: 120 requests per minute (sliding window)
- **Behavior**: If the limit is reached, requests automatically wait until a slot is available
- **No configuration needed**: Rate limiting is always active

This ensures that even aggressive AI usage won't overwhelm LACRM's servers.

## Security

### Authentication

- API key is loaded from `LACRM_API_KEY` environment variable (recommended)
- Fallback to config file at `~/.lacrm-config.json`
- API key is never logged or exposed in error messages

### ID Parameter Sanitization

The server includes defense-in-depth sanitization for all ID parameters. LLMs sometimes over-quote values, passing `"\"86441\""` (a string with embedded literal quotes) instead of the clean string `"86441"`. The LACRM API rejects values with embedded quotes as invalid UIDs.

To guard against this, the client automatically strips surrounding single and double quote characters from any parameter whose key ends with:

- `*Id` -- single ID parameters (e.g., `ContactId`, `PipelineId`)
- `*Ids` -- array-of-ID parameters (e.g., `ContactIds`)
- `*IdList` -- ID list parameters

When sanitization occurs, a warning is logged so the issue can be traced. Other string parameters (names, notes, descriptions, etc.) are never modified.

### File Upload Security

The `create_file` tool validates file paths to prevent:
- Path traversal attacks (`../` sequences)
- Access to sensitive directories (`.git`, `.env`, `.ssh`, `.aws`, `node_modules`, etc.)

### Input Validation

- All tool inputs are validated with Zod schemas
- Error responses use `isError: true` flag for LLM-friendly handling
- No shell command execution - all operations use direct API calls

## License

MIT
