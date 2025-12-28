/**
 * LACRM API Client
 *
 * Wrapper around the Less Annoying CRM REST API (v2).
 * All API calls are POST requests to a single endpoint with function name and parameters.
 *
 * API Documentation: https://www.lessannoyingcrm.com/developer-api
 *
 * Architecture:
 * - Singleton pattern for global client access
 * - Supports both JSON and multipart/form-data requests (for file uploads)
 * - Automatic error handling with typed exceptions
 *
 * @module client
 */

import { ApiError, AuthenticationError } from './utils/errors.js';
import { logger } from './utils/logger.js';

/**
 * LACRM API v2 error response structure.
 * Returned when an API call fails.
 */
interface ApiErrorResponse {
  ErrorCode: string;
  ErrorDescription: string;
}

/** LACRM API v2 endpoint - all requests go to this URL */
const API_BASE_URL = 'https://api.lessannoyingcrm.com/v2/';

/**
 * LACRM API client class.
 *
 * Provides methods for making API calls to Less Annoying CRM.
 * Uses the API key for authentication via Authorization header.
 */
export class LacrmClient {
  /** API key for authentication */
  private readonly apiKey: string;

  /**
   * Create a new LACRM client instance.
   * @param apiKey - The LACRM API key for authentication
   */
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Call a LACRM API function.
   *
   * The LACRM API uses a unique pattern where all calls POST to the same URL
   * with a Function name and Parameters object in the request body.
   *
   * @template T - The expected type of the Result field in the response
   * @param functionName - The API function name (e.g., "GetContact", "CreateContact")
   * @param parameters - The parameters object for the function call
   * @returns The API response Result field, typed as T
   * @throws {ApiError} If the API returns an error response
   * @throws {AuthenticationError} If authentication fails (401/403)
   *
   * @example
   * const contact = await client.call<ContactResponse>('GetContact', { ContactId: '123' });
   */
  async call<T = unknown>(
    functionName: string,
    parameters: Record<string, unknown> = {}
  ): Promise<T> {
    const body = {
      Function: functionName,
      Parameters: parameters
    };

    logger.debug(`API call: ${functionName}`, { parameters });

    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError();
      }

      // Try to read error details from response body
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        // If we can't parse the error body, throw a generic HTTP error
        throw new ApiError(
          `HTTP_${response.status}`,
          `HTTP error: ${response.status} ${response.statusText}`
        );
      }

      if (errorData && typeof errorData === 'object' && 'ErrorCode' in errorData) {
        const apiError = errorData as ApiErrorResponse;
        logger.error(`API error in ${functionName}`, apiError);
        throw new ApiError(apiError.ErrorCode, apiError.ErrorDescription);
      }

      throw new ApiError(
        `HTTP_${response.status}`,
        `HTTP error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // LACRM API v2 returns errors as { ErrorCode, ErrorDescription }
    // Success responses return the data directly (no wrapper)
    if (data && typeof data === 'object' && 'ErrorCode' in data) {
      const errorData = data as ApiErrorResponse;
      logger.error(`API error in ${functionName}`, errorData);
      throw new ApiError(errorData.ErrorCode, errorData.ErrorDescription);
    }

    return data as T;
  }

  /**
   * Call a LACRM API function that requires file upload.
   *
   * Uses multipart/form-data content type instead of JSON.
   * The file is sent as a Blob with the specified MIME type.
   *
   * @template T - The expected type of the Result field in the response
   * @param functionName - The API function name (e.g., "CreateFile")
   * @param parameters - The parameters object for the function call
   * @param file - The file data to upload
   * @param file.name - Filename for the uploaded file
   * @param file.content - File content as Uint8Array
   * @param file.mimeType - MIME type of the file (e.g., "application/pdf")
   * @returns The API response Result field, typed as T
   * @throws {ApiError} If the API returns an error response
   * @throws {AuthenticationError} If authentication fails (401/403)
   *
   * @example
   * const result = await client.callWithFile<{ FileId: string }>(
   *   'CreateFile',
   *   { ContactId: '123' },
   *   { name: 'doc.pdf', content: fileBytes, mimeType: 'application/pdf' }
   * );
   */
  async callWithFile<T = unknown>(
    functionName: string,
    parameters: Record<string, unknown>,
    file: { name: string; content: Uint8Array; mimeType: string }
  ): Promise<T> {
    const formData = new FormData();
    formData.append('Function', functionName);
    formData.append('Parameters', JSON.stringify(parameters));

    // Convert to ArrayBuffer to ensure compatibility with Blob constructor
    const arrayBuffer = file.content.buffer.slice(
      file.content.byteOffset,
      file.content.byteOffset + file.content.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: file.mimeType });
    formData.append('File', blob, file.name);

    logger.debug(`API call with file: ${functionName}`, { fileName: file.name });

    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Authorization': this.apiKey
        // Note: Don't set Content-Type for FormData - browser/node sets it with boundary
      },
      body: formData
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError();
      }

      // Try to read error details from response body
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        // If we can't parse the error body, throw a generic HTTP error
        throw new ApiError(
          `HTTP_${response.status}`,
          `HTTP error: ${response.status} ${response.statusText}`
        );
      }

      if (errorData && typeof errorData === 'object' && 'ErrorCode' in errorData) {
        const apiError = errorData as ApiErrorResponse;
        logger.error(`API error in ${functionName}`, apiError);
        throw new ApiError(apiError.ErrorCode, apiError.ErrorDescription);
      }

      throw new ApiError(
        `HTTP_${response.status}`,
        `HTTP error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // LACRM API v2 returns errors as { ErrorCode, ErrorDescription }
    // Success responses return the data directly (no wrapper)
    if (data && typeof data === 'object' && 'ErrorCode' in data) {
      const errorData = data as ApiErrorResponse;
      logger.error(`API error in ${functionName}`, errorData);
      throw new ApiError(errorData.ErrorCode, errorData.ErrorDescription);
    }

    return data as T;
  }
}

// ============================================================================
// Singleton Pattern Implementation
// ============================================================================

/**
 * Singleton instance of the LACRM client.
 * Initialized once during server startup and reused for all API calls.
 */
let clientInstance: LacrmClient | null = null;

/**
 * Initialize the LACRM client singleton.
 *
 * Must be called once during server startup before any tools are used.
 * Subsequent calls will replace the existing client instance.
 *
 * @param apiKey - The LACRM API key for authentication
 * @returns The initialized client instance
 */
export function initializeClient(apiKey: string): LacrmClient {
  clientInstance = new LacrmClient(apiKey);
  return clientInstance;
}

/**
 * Get the LACRM client singleton instance.
 *
 * Used by all tool implementations to access the API client.
 *
 * @returns The initialized client instance
 * @throws {AuthenticationError} If the client has not been initialized
 */
export function getClient(): LacrmClient {
  if (!clientInstance) {
    throw new AuthenticationError('Client not initialized. Call initializeClient first.');
  }
  return clientInstance;
}
