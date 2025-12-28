/**
 * Common Types for LACRM MCP Server
 *
 * Type definitions shared across the server for:
 * - API request/response structures
 * - Pagination handling
 * - Custom field values
 * - MCP tool results
 *
 * These types ensure type safety when working with the LACRM API
 * and MCP protocol responses.
 *
 * @module types/common
 */

// ============================================================================
// LACRM API Types
// ============================================================================

/**
 * Unique identifier type used by LACRM API.
 * All IDs in LACRM are transmitted as strings (often numeric strings).
 *
 * @example "3971579198060101921194362986880"
 */
export type Uid = string;

/**
 * Date format used by LACRM API.
 * Format: yyyy-mm-dd (ISO 8601 date only)
 *
 * @example "2024-01-15"
 */
export type DateString = string;

/**
 * DateTime format used by LACRM API.
 * Format: ISO 8601 with timezone
 *
 * @example "2024-01-15T09:30:00-05:00"
 */
export type DateTimeString = string;

/**
 * Standard response structure from the LACRM API.
 *
 * All API calls return this structure with:
 * - Success: boolean indicating if the call succeeded
 * - Error: present only on failure, contains Code and Message
 * - Result: present only on success, contains the response data
 *
 * @template T - The expected type of the Result field
 */
export interface ApiResponse<T = unknown> {
  /** Whether the API call succeeded */
  Success: boolean;
  /** Error details (only present when Success is false) */
  Error?: {
    /** Error code for programmatic handling (e.g., "InvalidParameter") */
    Code: string;
    /** Human-readable error message */
    Message: string;
  };
  /** Response data (only present when Success is true) */
  Result?: T;
}

/**
 * Pagination parameters accepted by list endpoints.
 */
export interface PaginationParams {
  /** Page number (1-indexed) */
  Page?: number;
  /** Number of results per page */
  NumRows?: number;
}

/**
 * Pagination information returned by list endpoints.
 */
export interface PaginationInfo {
  /** Current page number */
  CurrentPage: number;
  /** Total number of pages available */
  TotalPages: number;
  /** Total number of results across all pages */
  TotalResults: number;
}

/**
 * Possible value types for custom fields.
 *
 * The actual type depends on the field configuration:
 * - string: Text, TextArea, Date, Currency, Dropdown single-select
 * - number: Number fields
 * - boolean: Checkbox fields
 * - string[]: Checkbox multi-select, RadioList
 * - null: Unset/cleared field
 */
export type CustomFieldValue = string | number | boolean | string[] | null;

/**
 * Map of custom field IDs to their values.
 *
 * Keys are field IDs in the format "Custom_XXXX" where XXXX is a numeric ID.
 *
 * @example
 * {
 *   "Custom_3971579198060101921194362986880": "Gold",
 *   "Custom_1234567890123456789012345678901": 50000
 * }
 */
export type CustomFields = Record<string, CustomFieldValue>;

// ============================================================================
// MCP Tool Result Types
// ============================================================================

/**
 * Text content block for MCP tool responses.
 * The standard content type for returning text data from tools.
 */
export interface TextContent {
  /** Content type discriminator */
  type: 'text';
  /** The text content to return */
  text: string;
}

/**
 * Successful tool result structure.
 * Returned when a tool completes without errors.
 */
export interface ToolSuccess {
  /** Array of content blocks (typically text) */
  content: TextContent[];
  /** Optional flag - undefined or false indicates success */
  isError?: false;
}

/**
 * Error tool result structure.
 * Returned when a tool encounters an error.
 * The isError flag must be true to signal failure to the MCP client.
 */
export interface ToolError {
  /** Array of content blocks describing the error */
  content: TextContent[];
  /** Must be true to indicate an error occurred */
  isError: true;
}

/**
 * Union type for all possible tool results.
 * Tools must return either a success or error result.
 */
export type ToolResult = ToolSuccess | ToolError;
