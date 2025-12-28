/**
 * File Tools for LACRM MCP Server
 *
 * File attachment management:
 * - create_file: Upload files to contacts (base64 or file path)
 * - get_file: Retrieve file info and temporary download URL
 * - get_files_attached_to_contact: List all files for a contact
 *
 * Security:
 * - File paths are validated to prevent path traversal attacks
 * - Sensitive directories (.git, .env, etc.) are blocked
 * - Maximum file size: 50MB
 *
 * @module tools/files
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { basename, normalize } from 'path';
import { getClient } from '../../client.js';
import { formatErrorForLLM } from '../../utils/errors.js';

/**
 * Validate file path for security.
 * Prevents path traversal attacks and blocks access to sensitive directories.
 */
function validateFilePath(filePath: string): { valid: boolean; error?: string } {
  const normalized = normalize(filePath).replace(/\\/g, '/');

  // Block path traversal sequences
  if (normalized.includes('..')) {
    return { valid: false, error: 'Path cannot contain ".." (path traversal not allowed)' };
  }

  // Split path into segments for exact matching of sensitive directories
  const segments = normalized.toLowerCase().split('/');

  // Sensitive directories and files that should be blocked
  const forbiddenExact = new Set([
    '.git', '.env', '.ssh', '.aws', '.config',
    'node_modules', '__pycache__', '.venv',
    'credentials', 'secrets', '.npmrc', '.pypirc'
  ]);

  for (const segment of segments) {
    if (forbiddenExact.has(segment)) {
      return { valid: false, error: `Access to sensitive path "${segment}" is not allowed` };
    }
  }

  return { valid: true };
}

export function registerFileTools(server: McpServer): void {
  // create_file
  server.registerTool(
    'create_file',
    {
      title: 'Create File',
      description: `Upload a file and attach it to a contact in Less Annoying CRM.
Supports two input methods:
1. file_base64: Base64-encoded file content (for smaller files)
2. file_path: Local file path (server reads and uploads)

Required: contact_id, and either file_base64 or file_path.
Maximum file size: 50MB.`,
      inputSchema: {
        contact_id: z.string().describe('Contact or company ID to attach file to'),
        file_base64: z.string().optional().describe('Base64-encoded file content'),
        file_path: z.string().optional().describe('Local file path to upload'),
        file_name: z.string().optional().describe('Display name for the file (required if using base64)'),
        mime_type: z.string().optional().describe('MIME type (e.g., "application/pdf")')
      }
    },
    async (args) => {
      try {
        const client = getClient();

        let fileContent: Uint8Array;
        let fileName: string;
        let mimeType: string;

        if (args.file_base64) {
          if (!args.file_name) {
            return {
              content: [{ type: 'text' as const, text: 'Error: file_name is required when using file_base64' }],
              isError: true
            };
          }
          fileContent = Uint8Array.from(Buffer.from(args.file_base64, 'base64'));
          fileName = args.file_name;
          mimeType = args.mime_type || 'application/octet-stream';
        } else if (args.file_path) {
          // Validate path for security
          const validation = validateFilePath(args.file_path);
          if (!validation.valid) {
            return {
              content: [{ type: 'text' as const, text: `Security error: ${validation.error}` }],
              isError: true
            };
          }

          try {
            fileContent = new Uint8Array(readFileSync(args.file_path));
            fileName = args.file_name || basename(args.file_path);
            mimeType = args.mime_type || 'application/octet-stream';
          } catch (err) {
            return {
              content: [{ type: 'text' as const, text: `Error reading file: ${err instanceof Error ? err.message : 'Unknown error'}` }],
              isError: true
            };
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: 'Error: Either file_base64 or file_path is required' }],
            isError: true
          };
        }

        const result = await client.callWithFile<{ FileId: string }>(
          'CreateFile',
          { ContactId: args.contact_id },
          { name: fileName, content: fileContent, mimeType }
        );

        return {
          content: [{ type: 'text' as const, text: `File uploaded successfully. FileId: ${result.FileId}` }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_file
  server.registerTool(
    'get_file',
    {
      title: 'Get File',
      description: `Retrieve file information and a temporary download URL.
NOTE: The download URL expires after 5 minutes. Call this again if you need a fresh URL.

Returns file metadata including name, size, type, and download link.`,
      inputSchema: {
        file_id: z.string().describe('The FileId to retrieve')
      }
    },
    async ({ file_id }) => {
      try {
        const client = getClient();
        const result = await client.call('GetFile', { FileId: file_id });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );

  // get_files_attached_to_contact
  server.registerTool(
    'get_files_attached_to_contact',
    {
      title: 'Get Files For Contact',
      description: `Retrieve all files attached to a specific contact.
Optionally include previous file versions.
NOTE: Does not include files attached via File Link custom fields.`,
      inputSchema: {
        contact_id: z.string().describe('The ContactId to get files for'),
        include_versions: z.boolean().optional().describe('Include previous file versions (default: false)')
      }
    },
    async ({ contact_id, include_versions }) => {
      try {
        const client = getClient();

        const params: Record<string, unknown> = { ContactId: contact_id };
        if (include_versions !== undefined) params.ReturnPreviousVersions = include_versions;

        const result = await client.call('GetFilesAttachedToContact', params);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: formatErrorForLLM(error) }],
          isError: true
        };
      }
    }
  );
}
