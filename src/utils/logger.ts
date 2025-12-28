/**
 * Logger Utility for LACRM MCP Server
 *
 * Provides structured logging that writes exclusively to stderr.
 *
 * CRITICAL: MCP servers using stdio transport communicate via stdout.
 * Using console.log() would corrupt the JSON-RPC protocol stream.
 * All logging MUST use console.error() to write to stderr instead.
 *
 * Log levels:
 * - debug: Detailed debugging info (only when DEBUG env var is set)
 * - info: General operational messages
 * - warn: Warning conditions that should be noted
 * - error: Error conditions that affect operation
 *
 * @module logger
 *
 * @example
 * import { logger } from './utils/logger.js';
 *
 * logger.info('Server started');
 * logger.debug('API call', { function: 'GetContact', params: { id: '123' } });
 * logger.error('Failed to connect', error);
 */

/**
 * Logger object with level-specific methods.
 * All methods write to stderr with a level prefix.
 */
export const logger = {
  /**
   * Log an informational message.
   * @param msg - The message to log
   * @param data - Optional data to include (will be stringified)
   */
  info: (msg: string, data?: unknown): void => {
    console.error(`[INFO] ${msg}`, data !== undefined ? data : '');
  },

  /**
   * Log a warning message.
   * @param msg - The warning message
   * @param data - Optional data to include
   */
  warn: (msg: string, data?: unknown): void => {
    console.error(`[WARN] ${msg}`, data !== undefined ? data : '');
  },

  /**
   * Log an error message.
   * @param msg - The error message
   * @param data - Optional error object or data
   */
  error: (msg: string, data?: unknown): void => {
    console.error(`[ERROR] ${msg}`, data !== undefined ? data : '');
  },

  /**
   * Log a debug message (only when DEBUG environment variable is set).
   * @param msg - The debug message
   * @param data - Optional data to include
   */
  debug: (msg: string, data?: unknown): void => {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] ${msg}`, data !== undefined ? data : '');
    }
  }
};
