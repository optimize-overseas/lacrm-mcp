# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`lacrm-mcp` is an MCP (Model Context Protocol) server for Less Annoying CRM. It exposes 87 tools across contacts, pipelines, tasks, events, notes, emails, files, relationships, groups, settings, and bulk CSV operations.

Published to npm. Can be deployed standalone or behind a proxy/wrapper for additional enforcement (e.g., rate limiting, operation budgets, blocked tools).

## Build & Development

```bash
npm run build          # rm -rf build && tsc -> build/  (test files excluded from the published build)
npm test               # vitest run - unit tests for the bulk-CSV logic
npm run inspector      # Launch MCP Inspector for manual testing
```

Tests: vitest (`*.test.ts`, currently covering `tools/bulk/`). Older domains are validated via `npm run build` + MCP Inspector.

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
    bulk/           - Generic bulk-CSV import/update (4 tools) + pure logic: merge (column-presence
                      strategies), csv parse/write, validate, template, throttle (1 req/s), runstore, runner
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
    summarize.ts    - summarizeResults() for list-returning tools (page_count, not total - v1.3.1)
    resolve-names.ts - Name resolution: status/user/calendar names->IDs; custom-field names validated + written BY NAME (v1.4.1 - v2 ignores ID-keyed custom-field writes; defensive wrapped-vs-array parse)
    count-all.ts    - Auto-pagination for count_only mode (v1.3.0, pagination fix v1.3.1)
  types/
    common.ts       - Shared types (Uid, ApiResponse, ToolResult, etc.)
    index.ts        - Re-exports
```

## Key Patterns

- **Tool registration**: Each domain has a `register*Tools(server)` function called from `tools/index.ts`
- **API calls**: All go through `LacrmClient.call()` which handles rate limiting (120 req/min) and ID sanitization
- **List responses**: Tools returning lists use `summarizeResults()` to wrap in `{summary, results}` envelope. The summary field `page_count` is the count for the current page only (not the total). When `has_more_results` is true, a `note` field reminds the caller to use `count_only=true` for accurate totals.
- **Name resolution** (v1.3.0): Tools accepting ID filters also accept name-based alternatives (e.g., `status_name` instead of `status_id`). Resolution uses functions in `utils/resolve-names.ts` which query the API at runtime. All lookups are case-insensitive. Name params are mutually exclusive with their ID counterparts.
- **Count mode** (v1.3.0): All search/list tools accept `count_only: true`. When enabled, `countAll()` from `utils/count-all.ts` auto-paginates all pages (100-page safety cap, 10,000 items per page) and returns `{total, breakdowns}` with no results array. Handles both wrapped `{Results, HasMoreResults}` and plain array API responses (v1.3.1 fix).
- **Flat-string shortcuts** (v1.3.0): `create_contact` and `edit_contact` accept `email_address`, `phone_number`, `website_url` as simple strings, auto-converted to the array-of-objects format the API expects. Mutually exclusive with the array versions.
- **Bulk CSV** (v1.4.0, `tools/bulk/`): 4 tools (`bulk_generate_template`/`bulk_validate_csv`/`bulk_execute`/`bulk_run_status`). **Strictly instance-agnostic** - the caller passes the entire field configuration (column->field mapping, per-field merge `strategy`, create defaults) as arguments; no field names/rules are hardcoded. `bulk_execute` writes a run spec to `LACRM_BULK_RUNS_DIR` and spawns the detached `build/bulk-worker.js` process, which paces calls at 1 req/s (LACRM agreement) via `throttle.ts`, persists progress (`runstore.ts`) so it survives restarts/resumes, and writes a report CSV. Update merge model is **column-presence**: absent column = preserve; present cell applies its `strategy` (`replace` blank-clears, `preserve_if_blank`, `union_semicolon`, `never_write`). All logic is unit-tested (vitest, `npm test`).
- **Async completion delivery** (v1.9.0, OPT-IN, `tools/bulk/async-delivery.ts`): `bulk_execute` accepts four OPTIONAL params - `channel` (googlechat|gmail|asana), `requestor_email`, `identifier`, `request_summary`. When the three identity fields are all present at `confirm:true`, the launcher registers the run as a job with a host-provided async completion service (endpoint from `ASYNC_DAEMON_URL`) BEFORE spawning, and persists the minted `jobId` into the run spec. The worker then (1) heartbeats the ledger every 60 s (the service marks a silent job stale well before a big run finishes), (2) at completion optionally uploads the report CSV as an editable Google Sheet by shelling out to a host-provided hook (this package has no Drive client; pure opt-in env config `LACRM_BULK_SHEET_PYTHON` + `LACRM_BULK_SHEET_SCRIPT`, used verbatim, NO built-in defaults - v1.9.1: when either is unset the worker SKIPS the upload with one log line and the summary notes the report file was retained on the host), and (3) terminal-posts SUCCEEDED with the sheet link (when uploaded) + counts + a deterministic plain-language `userText` (FAILED carries an internal-only `reason`). **Degrade, never block:** a ledger-create failure launches the run with no jobId and the pre-v1.9.0 poll flow applies byte-identically; a spec without a jobId changes nothing. `bulk_run_resume` relaunches on the SAME spec, so a resumed run heartbeats and completes the SAME ledger job. Callers that never pass the fields (the public npm audience) see zero behavior change.
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
npm install -g lacrm-mcp@latest
```

Operators keep host-specific integration runbooks (install paths, service wiring, daemon setup, deploy gating) in their own infrastructure docs - none of that belongs in this repo.

### The async-task-core dependency is VENDORED + BUNDLED (do not convert to a path/registry dep)

`async-task-core` is not on the public registry, and this package installs from the public registry
on target hosts, so a path dep would not exist at install time and would break the install. The
surviving form is:

- `vendor/optimizeoverseas-async-task-core-<ver>.tgz` - the packed SDK tarball, committed to this repo
  (regenerate by packing the SDK into `vendor/`).
- `dependencies` points at that tarball (`file:vendor/...tgz`) and the package is listed in
  **`bundleDependencies`**, so `npm publish` ships `node_modules/@optimizeoverseas/async-task-core`
  INSIDE the published tarball and the global install never consults a registry for it
  (`vendor/` is also in `files` as belt-and-suspenders).

To bump the SDK: repack into `vendor/`, update the `file:` version in `package.json`, `npm install`,
commit the tarball + lockfile together.

## Important Notes

- All logging goes to stderr (stdout is the MCP JSON-RPC stream)
- **Debug param logging (secret/PII hygiene, 2026-07-16):** the `[DEBUG] API call` line is `DEBUG`-gated *and* logs only the parameter **keys** by default - LACRM params routinely carry PII (names, addresses, notes). To log full param **values** for deep debugging, set `LACRM_DEBUG_PARAMS` (e.g. `LACRM_DEBUG_PARAMS=1`); even then, token-shaped values are masked via `src/utils/redact.ts` (`debugParams`/`debugFileMeta`). The API key is sent in the `Authorization` header, never in params, so it is not at risk in these logs.
- ID parameters are automatically sanitized to strip accidental quote characters
- Name resolution parameters (v1.3.0) are always mutually exclusive with their ID-based counterparts -- providing both will error
- `count_only` mode (v1.3.0) makes additional API calls to paginate all pages; the 100-page safety cap prevents runaway usage. v1.3.1 fixed a bug where pagination would stop after page 1 if the API returned a plain array instead of `{Results, HasMoreResults}`
- Flat-string shortcuts (v1.3.0) on contacts are convenience sugar -- they are mutually exclusive with the array-form parameters
