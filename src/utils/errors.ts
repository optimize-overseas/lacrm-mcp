/**
 * Custom Error Classes for LACRM MCP Server
 *
 * Provides a hierarchy of error types for different failure scenarios:
 * - LacrmError: Base class for all LACRM-specific errors
 * - AuthenticationError: API key issues
 * - ValidationError: Invalid input parameters
 * - NotFoundError: Resource not found
 * - ApiError: Errors returned by the LACRM API
 *
 * All errors include LLM-friendly messages that help AI assistants
 * understand and recover from failures.
 *
 * @module errors
 */

/**
 * Base error class for all LACRM-specific errors.
 * Extends the built-in Error class with proper name assignment.
 */
export class LacrmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LacrmError';
  }
}

/**
 * Error thrown when authentication fails.
 *
 * This can occur when:
 * - API key is missing from configuration
 * - API key is invalid or expired
 * - API returns 401/403 status
 */
export class AuthenticationError extends LacrmError {
  constructor(message = 'Invalid or missing API key. Set LACRM_API_KEY environment variable.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when input validation fails.
 *
 * Used for client-side validation before making API calls,
 * such as missing required fields or invalid formats.
 */
export class ValidationError extends LacrmError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when a requested resource is not found.
 *
 * The message includes guidance to use search tools to find valid IDs,
 * helping the LLM recover from the error.
 */
export class NotFoundError extends LacrmError {
  constructor(resource: string, id: string) {
    super(`${resource} not found with ID: ${id}. Use search tools to find valid IDs.`);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when the LACRM API returns an error response.
 *
 * Contains the error code from the API for programmatic handling
 * and optional details for debugging.
 */
export class ApiError extends LacrmError {
  /** API error code (e.g., "InvalidParameter", "NotFound") */
  public readonly code: string;
  /** Additional error details from the API response */
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Format an error for LLM-friendly response.
 *
 * Converts various error types into actionable messages that help
 * AI assistants understand what went wrong and how to recover.
 *
 * Message patterns:
 * - AuthenticationError: Guides to check API key configuration
 * - NotFoundError: Suggests using search tools
 * - ValidationError: Describes the validation failure
 * - ApiError: Includes error code for reference
 * - Generic Error: Passes through the message
 *
 * @param error - The error to format (can be any type)
 * @returns A human-readable error message suitable for LLM consumption
 *
 * @example
 * try {
 *   await client.call('GetContact', { ContactId: 'invalid' });
 * } catch (error) {
 *   return { content: [{ type: 'text', text: formatErrorForLLM(error) }], isError: true };
 * }
 */
export function formatErrorForLLM(error: unknown): string {
  if (error instanceof AuthenticationError) {
    return `Authentication failed. Ensure LACRM_API_KEY is set correctly in your environment.`;
  }

  if (error instanceof NotFoundError) {
    return error.message;
  }

  if (error instanceof ValidationError) {
    return `Validation error: ${error.message}`;
  }

  if (error instanceof ApiError) {
    return `API error (${error.code}): ${error.message}`;
  }

  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }

  return 'An unexpected error occurred.';
}
