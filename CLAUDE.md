# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@optimizeoverseas/lacrm-mcp` is an MCP (Model Context Protocol) server for Less Annoying CRM (v1.3.0). It exposes 83 tools across contacts, pipelines, tasks, events, notes, emails, files, relationships, groups, and settings.

Published to npm. Can be deployed standalone or behind a proxy/wrapper for additional enforcement (e.g., rate limiting, operation budgets, blocked tools).

## Build & Development

```bash
npm run build          # tsc -> build/
npm run inspector      # Launch MCP Inspector for manual testing
```

No test suite. Validation is via `npm run build` + MCP Inspector.

## Architecture

```
src/
  index.ts          - Entry point: loads config, initializes client, registers tools
  client.ts         - LacrmClient singleton: API calls, rate limiting, ID sanitization
  config.ts         - Loads API key from env or config file
  tools/
    index.ts        - Central registry, calls all register*Tools functions
    discovery/      - get_workflow_guide, get_custom_fields, get_pipelines, get_users, etc. (10 tools)
    contacts/       - CRUD + search for contacts/companies (6 tools)
    pipeline-items/ - CRUD + search for pipeline items/deals (7 tools)
    tasks/          - CRUD + search for tasks (6 tools)
    notes/          - CRUD + search for notes (6 tools)
    events/         - CRUD + search for events (6 tools)
    emails/         - CRUD + search for logged emails (5 tools)
    files/          - Upload + retrieve files (3 tools)
    relationships/  - Manage contact relationships (5 tools)
    groups/         - Group membership management (4 tools)
    settings/       - Admin tools: custom fields, pipelines, teams, webhooks (25 tools)
  resources/        - MCP workflow resources for AI discoverability
  utils/
    errors.ts       - Error classes + formatErrorForLLM()
    logger.ts       - stderr-only logger (stdout is MCP protocol)
    summarize.ts    - summarizeResults() for list-returning tools
    resolve-names.ts - Name-to-ID resolution (status, user, calendar, custom fields) (v1.3.0)
    count-all.ts    - Auto-pagination for count_only mode (v1.3.0)
  types/
    common.ts       - Shared types (Uid, ApiResponse, ToolResult, etc.)
    index.ts        - Re-exports
```

## Key Patterns

- **Tool registration**: Each domain has a `register*Tools(server)` function called from `tools/index.ts`
- **API calls**: All go through `LacrmClient.call()` which handles rate limiting (120 req/min) and ID sanitization
- **List responses**: Tools returning lists use `summarizeResults()` to wrap in `{summary, results}` envelope
- **Name resolution** (v1.3.0): Tools accepting ID filters also accept name-based alternatives (e.g., `status_name` instead of `status_id`). Resolution uses functions in `utils/resolve-names.ts` which query the API at runtime. All lookups are case-insensitive. Name params are mutually exclusive with their ID counterparts.
- **Count mode** (v1.3.0): All search/list tools accept `count_only: true`. When enabled, `countAll()` from `utils/count-all.ts` auto-paginates all pages (100-page safety cap) and returns `{total, breakdowns}` with no results array.
- **Flat-string shortcuts** (v1.3.0): `create_contact` and `edit_contact` accept `email_address`, `phone_number`, `website_url` as simple strings, auto-converted to the array-of-objects format the API expects. Mutually exclusive with the array versions.
- **Error handling**: All tool handlers catch errors and return `formatErrorForLLM(error)` with `isError: true`
- **Logging**: Use `logger.*` from `utils/logger.ts` -- NEVER use `console.log` (corrupts MCP stdio protocol)

## LACRM API

- Single endpoint: `POST https://api.lessannoyingcrm.com/v2/`
- Request body: `{ "Function": "GetContact", "Parameters": { "ContactId": "123" } }`
- Auth: API key in `Authorization` header
- Rate limit: 120 requests/minute (enforced client-side)

## Deployment

```bash
npm version patch|minor|major
git push origin main --tags
npm publish --access public
# On target host:
npm install -g @optimizeoverseas/lacrm-mcp@latest
```

## Important Notes

- All logging goes to stderr (stdout is the MCP JSON-RPC stream)
- ID parameters are automatically sanitized to strip accidental quote characters
- Name resolution parameters (v1.3.0) are always mutually exclusive with their ID-based counterparts -- providing both will error
- `count_only` mode (v1.3.0) makes additional API calls to paginate all pages; the 100-page safety cap prevents runaway usage
- Flat-string shortcuts (v1.3.0) on contacts are convenience sugar -- they are mutually exclusive with the array-form parameters
