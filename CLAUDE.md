# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@optimizeoverseas/lacrm-mcp` is an MCP (Model Context Protocol) server for Less Annoying CRM. It exposes 83 tools across contacts, pipelines, tasks, events, notes, emails, files, relationships, groups, and settings.

Used by Allegiance AI (via OpenClaw + enforcement wrapper at `optimize-overseas/lacrmenforcement-wrapper`). Published to npm, deployed globally on the production VM.

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
  types/
    common.ts       - Shared types (Uid, ApiResponse, ToolResult, etc.)
    index.ts        - Re-exports
```

## Key Patterns

- **Tool registration**: Each domain has a `register*Tools(server)` function called from `tools/index.ts`
- **API calls**: All go through `LacrmClient.call()` which handles rate limiting (120 req/min) and ID sanitization
- **List responses**: Tools returning lists use `summarizeResults()` to wrap in `{summary, results}` envelope
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
ssh allegiance 'npm install -g @optimizeoverseas/lacrm-mcp@latest && systemctl --user restart openclaw-allegiance'
```

## Related Repos

- `optimize-overseas/lacrmenforcement-wrapper` -- Transparent proxy that blocks deletes and enforces session budgets
- `optimize-overseas/allegiance-ai` -- The AI system that uses this MCP server via OpenClaw

## Important Notes

- All logging goes to stderr (stdout is the MCP JSON-RPC stream)
- ID parameters are automatically sanitized to strip accidental quote characters
- The enforcement wrapper runs between OpenClaw and this MCP server (see mcporter.json in allegiance-ai)
