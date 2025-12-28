#!/usr/bin/env node
/**
 * LACRM MCP Server - Entry point
 *
 * Model Context Protocol (MCP) server for Less Annoying CRM.
 * This server enables AI assistants (like Claude) to interact with LACRM
 * through a standardized tool interface.
 *
 * Features:
 * - 75 tools covering contacts, events, tasks, notes, pipelines, emails, files, and settings
 * - Secure API key authentication via environment variable or config file
 * - Comprehensive error handling with LLM-friendly messages
 * - Full CRUD operations for all LACRM entities
 *
 * Usage:
 * 1. Set LACRM_API_KEY environment variable or create ~/.lacrm-config.json
 * 2. Run via MCP client (e.g., Claude Desktop, MCP Inspector)
 *
 * @module lacrm-mcp
 * @see https://www.lessannoyingcrm.com/developer-api
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { initializeClient } from './client.js';
import { registerAllTools } from './tools/index.js';
import { logger } from './utils/logger.js';

/**
 * Main server initialization function.
 *
 * Performs the following steps:
 * 1. Loads configuration (API key) from environment or config files
 * 2. Initializes the LACRM API client singleton
 * 3. Creates and configures the MCP server with all tools
 * 4. Connects via stdio transport for communication with MCP clients
 *
 * @throws Exits with code 1 if initialization fails
 */
async function main(): Promise<void> {
  try {
    // Load configuration from environment or config files
    const config = loadConfig();
    logger.info('Configuration loaded');

    // Initialize the API client singleton with the loaded API key
    initializeClient(config.apiKey);
    logger.info('API client initialized');

    // Create MCP server instance with server metadata
    const server = new McpServer({
      name: 'lacrm-mcp',
      version: '1.0.0'
    });

    // Register all 75 tools across discovery, contacts, activities, settings, etc.
    registerAllTools(server);
    logger.info('Tools registered');

    // Connect using stdio transport for MCP protocol communication
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('LACRM MCP server started');
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

// Start the server
main();
