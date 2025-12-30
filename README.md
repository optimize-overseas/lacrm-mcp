# LACRM MCP Server

A Model Context Protocol (MCP) server for Less Annoying CRM that provides comprehensive API access through 83 tools.

## Installation

```bash
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

LACRM supports custom fields on contacts, companies, and pipeline items. The `get_custom_fields` tool returns AI-friendly information including:

- **name**: The field name to use as key when setting values
- **required**: Whether this field must be provided
- **type**: Field type (Text, Number, Dropdown, Date, etc.)
- **input_format**: Description of expected value format
- **valid_options**: For Dropdown/RadioList/Checkbox fields, the allowed values

### For Contacts/Companies:

1. Call `get_custom_fields` with `record_type="Contact"` or `record_type="Company"`
2. Note the field names and whether they are required
3. Use field names as keys in the `custom_fields` parameter

### For Pipeline Items:

1. Call `get_pipeline_custom_fields` with the `pipeline_id`
2. Note all required fields and their valid options
3. Use field names as keys in the `custom_fields` parameter when creating/editing

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

1. Call `get_pipelines` to discover pipeline IDs and their statuses
2. Call `get_pipeline_custom_fields` with the pipeline_id to see required fields
3. Use `create_pipeline_item` with `pipeline_id`, `status_id`, and `custom_fields`

The tools provide clear error messages when required fields are missing.

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
